// ═══════════════════════════════════════════════════════════════════════════
// The assistant — a band across the top of the console that helps set up and use it
// (console 0.7.122, edge function `assistant`; a side panel until 19 Nov 2026)
//
// A conversation per FarmBox. The assistant reads the farm as the person
// signed in (their permissions, nothing more) and answers; when it wants to
// change something it sends a card — what it would do, in one sentence — and
// nothing happens until the person presses "Do it", which runs the change as
// them, exactly like pressing the same button on the page would. It never
// validates a plan, approves anything or marks a task done. Pictures, PDFs,
// Excel and CSV files can be attached; the function reads them.
//
// The compact band (19 Nov 2026, owner): the head is the conversation's title (no avatar, no gear, no
// prepared questions); the question box has the voice button, the units as one small line, "New chat", "To check" and Send; the
// settings of the cards are in Settings › Assistant. One conversation per person and FarmBox across pages since P2 (20 Nov 2026), each question stamped with its page; "To check" asks what on the page needs checking.
//
// The band (19 Nov 2026): the answers on the left two thirds, the question on the right third, with the page and the units
// on screen as chips that go with the question (a click drops one). A click on its grip opens or closes it; a drag
// makes it taller or shorter, snapping to closed, a fifth, a third or half the window; the height is kept per person and
// per screen (fbc_band_…). Closed it is one line — the question box stays — and a question slides it open to a fifth.
//
// Answer shapes (AI build mode P1, 20 Nov 2026, docs/ai-build-mode.md): chips Answer · Brief · Plan above the question
// (none ticked = auto; Build waits for P5), sent as `shape`; the reply starts with <<shape:…>>, stripped here and drawn
// by assistant-shape.js's rules: answer = a compact box of short bullets (the default for a plain question), brief = the
// coloured blocks, plan = coloured step lines and the count of its cards by page. No tag: drawn as before.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn } from './api.js';
import { el, toast, pref, escapeHtml } from './ui.js';
import { createMic, readAllOn } from './assistant-local.js';
import { SHAPE_CHIPS, splitShape, answerLines, planLines, cardsAfter, cardsLine } from './assistant-shape.js';

// the changes a card may carry — the same list the function accepts
const ALLOWED = new Set(['plan_position', 'plan_succession', 'steady_apply', 'move_batch', 'resize_batch', 'change_batch_crop',
  'cancel_crop_plan', 'set_batch_nursery', 'split_zone', 'clear_zone', 'save_order', 'plan_order_line', 'save_procedure',
  'save_crop', 'record_market_price', 'raise_issue', 'save_asset', 'save_maintenance_rule', 'save_farm_holiday', 'apply_batch_adjustment', 'fork_crop']);
// "To check" (owner, 19 Nov 2026): the button beside Send; the person sees "To check", the assistant reads the longer ask
const SPEAKER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const CHECK = 'To check';
const CHECK_ASK = 'Check the page on screen and tell me what needs checking: late or overdue items, readings or numbers that look wrong, anything waiting for a decision. A short list, the most important first, at most 6 lines. Say plainly if nothing needs attention.';
const KEEP_DAYS = 30;   // a page's conversation not opened for this long is dropped from this browser

let ctx = null;              // { farm(), refresh() } from app.js
let band, grip, list, input, sendBtn, checkBtn, fileIn, busyRow, peek, ctxRow, titleEl, ageEl, mic;
let ctxOff = { page: false, units: false };   // the chips the person dropped for the next question
let shapePick = null, shapeRow;   // the shape ticked for the next question (null = auto); it goes back to auto once sent
const convos = new Map();    // person | farm id → { messages (as the function returned them), view, notes, chatId, at, fresh, stamp }
let files = [];
let followPage = true;       // "Follow the page" (P2): on, a question is about the page on screen; off, about the page of the one before

// ONE conversation per person and FarmBox, across pages (AI build mode P2, 20 Nov 2026; it was one per page from 19 Nov).
// It is kept on the platform (ai_chat, 0275) and loaded from there (ai_chat_latest, with each question's page since
// 0284); this browser's copy (fbc_aic_<person>|<farm>) is only a cache, shown at once and replaced when the platform's is
// newer (another device). The per-page copies of 19 Nov are deleted: the platform's latest chat, which is the one held
// last on any page, becomes the farm's conversation. The answer text never changes when the page changes.
const ckey = () => (ctx.user?.() || 'none') + '|' + (ctx.farm()?.id || 'none');
const blank = () => ({ messages: [], view: [], notes: [], chatId: null, at: 0 });
const synced = new Set();    // the conversations already asked of the platform in this tab
const convo = () => {
  const id = ckey();
  if (!convos.has(id)) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('fbc_aic_' + id) || 'null'); } catch { /* none */ }
    if (saved) { saved.seen = Date.now(); try { localStorage.setItem('fbc_aic_' + id, JSON.stringify(saved)); } catch { /* full */ } }   // opened: it is kept another month
    convos.set(id, saved || blank());
  }
  if (!synced.has(id) && ctx.farm()) { synced.add(id); fromPlatform(id, ctx.farm().id); }
  return convos.get(id);
};
// the platform's copy: taken when this browser has none, or when the platform's is newer (asked on another device);
// never over a conversation the person has just started here ("New chat")
async function fromPlatform(id, farmId) {
  let r = null;
  try { r = await rpc('ai_chat_latest', { p_farm: farmId }, { quiet: true }); } catch { return; }   // offline: the cache stands
  const c = convos.get(id);
  if (!r || !c || sending) return;
  const at = Date.parse(r.updated_at || '') || 0;
  const newer = at && at > (c.at || 0) + 2000;
  if (c.fresh || !(c.view.length === 0 || newer)) return;
  if (r.chat_id === c.chatId && !newer) return;
  convos.set(id, { messages: Array.isArray(r.messages) ? r.messages : [], view: Array.isArray(r.view) ? r.view : [], notes: [],
                   chatId: r.chat_id || null, at: at || Date.now() });
  save(id);
  if (id === ckey() && band && mode === 'chat') paint();
}
// id: the key of the conversation (person | farm) — an answer that lands after a switch of FarmBox is saved with its own
// conversation, not the one now on screen (review 3 Oct 2026)
const save = (id = ckey()) => {
  if (!id || !convos.has(id)) return;
  try {
    const s = JSON.stringify(convos.get(id));
    if (s.length < 3_000_000) localStorage.setItem('fbc_aic_' + id, s); else localStorage.removeItem('fbc_aic_' + id);
  } catch { /* private window, or full */ }
};
// conversations not opened for a month go from this browser (they stay on the platform); the per-page copies of 19 Nov
// (fbc_ai_<farm>|<page>) and the single ones before them go at once
function prune() {
  try {
    const old = Date.now() - KEEP_DAYS * 864e5;
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('fbc_ai_') && k.includes('|')) { localStorage.removeItem(k); return; }   // the old per-page copies; not the device's settings
      if (!k.startsWith('fbc_aic_')) return;
      let at = 0;
      try { const o = JSON.parse(localStorage.getItem(k) || '{}'); at = Math.max(o.seen || 0, o.at || 0); } catch { /* unreadable: goes */ }
      if (at < old) localStorage.removeItem(k);
    });
  } catch { /* no storage */ }
}
// the page a question is about: the page on screen, or, with "Follow the page" off, the page of the question before
function stampNow(c, w, check) {
  const here = { route: (location.hash || '#/').split('?')[0], title: w.page || '', units: w.units || [], unitIds: w.unitIds || null, allUnitIds: w.allUnitIds || null };
  return !check && !followPage && c.stamp ? c.stamp : here;
}

// a little markdown: paragraphs, **bold**, `code`, lists — escaped first. And the answer's own marks (19 Nov 2026, owner:
// "more visual, colour and blocks, for ADHD people"): the first line large; [[70 planned | 18 done]] as figure tiles;
// a line starting with 🔴 🟠 🟢 🔵 ❓ as a coloured block (red: act now, orange: watch, green: fine, blue: next step / info)
const MARK = { '🔴': 'red', '🟠': 'amber', '🟡': 'amber', '🟢': 'green', '🔵': 'blue', '❓': 'ask' };
const MARK_RE = /^\s*(?:[-•*]\s+)?(🔴|🟠|🟡|🟢|🔵|❓)️?\s*(.*)$/u;
const inline = s => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
function md(text) {
  const box = el('div', 'ai-md');
  let html = '', listOpen = null, first = true;
  const close = () => { if (listOpen) { html += `</${listOpen}>`; listOpen = null; } };
  const lines = String(text || '').split(/\n/);
  const visual = lines.some(l => MARK_RE.test(l) || /^\s*\[\[.+\]\]\s*$/.test(l));   // a lead line only in a drawn answer
  lines.forEach(line => {
    const kpi = /^\s*\[\[(.+)\]\]\s*$/.exec(line), mark = MARK_RE.exec(line);
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line), h = /^#{1,4}\s+(.*)$/.exec(line);
    if (kpi) {
      close();
      html += '<div class="ai-kpis">' + kpi[1].split('|').map(p => p.trim()).filter(Boolean).map(p => {
        const m = /^([-+]?[\d.,]+\s*(?:%|kg|R|h|d)?)\s+(.+)$/.exec(p);
        return m ? `<div class="ai-kpi"><b>${escapeHtml(m[1])}</b><span>${escapeHtml(m[2])}</span></div>` : `<div class="ai-kpi"><span>${escapeHtml(p)}</span></div>`;
      }).join('') + '</div>';
    } else if (mark) { close(); html += `<div class="ai-blk ${MARK[mark[1]]}">${inline(mark[2])}</div>`; }
    else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (listOpen !== kind) { close(); html += `<${kind}>`; listOpen = kind; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (h) { close(); html += `<p><b>${inline(h[1])}</b></p>`; }
    else if (!line.trim()) { close(); return; }
    else { close(); html += `<p${visual && first ? ' class="ai-lead"' : ''}>${inline(line)}</p>`; }
    first = false;
  });
  close();
  box.innerHTML = html;
  return box;
}

// ── the shapes of an answer (AI build mode P1, 20 Nov 2026): answer · brief · plan ─────────────────────────────────
// answer: one compact box of short bullets (the default for a plain question)
function answerBox(text) {
  const box = el('div', 'ai-md ai-answer');
  const lines = answerLines(text);
  const ul = el('ul');
  lines.filter(l => !l.ask).forEach(l => { const li = el('li'); li.innerHTML = inline(l.text); ul.append(li); });
  if (ul.children.length) box.append(ul);
  lines.filter(l => l.ask).forEach(l => { const d = el('div', 'ai-blk ask'); d.innerHTML = inline(l.text); box.append(d); });
  return box;
}
// plan: a lead line, one coloured line per step ([+] new blue, [~] changed amber, [-] removed red, [=] checked green), the
// cards it comes with counted by page
const STEP_SIGN = { new: '+', changed: '~', removed: '−', same: '=' };
function planBox(text, cards) {
  const box = el('div', 'ai-md ai-plan');
  planLines(text).forEach(l => {
    if (l.kind === 'step') {
      const d = el('div', 'ai-step ' + l.mark);
      d.append(el('b', 'ai-step-sign', STEP_SIGN[l.mark]));
      const t = el('span'); t.innerHTML = inline(l.text); d.append(t);
      box.append(d);
    } else {
      const d = el(l.kind === 'ask' ? 'div' : 'p', l.kind === 'ask' ? 'ai-blk ask' : l.kind === 'lead' ? 'ai-lead' : null);
      d.innerHTML = inline(l.text); box.append(d);
    }
  });
  box.append(el('div', 'ai-plan-cards', cardsLine(cards)));
  return box;
}
// the answer drawn by its shape; no tag (an older answer, or the model forgot it) = drawn as before
function drawAnswer(text, cards) {
  const s = splitShape(text);
  if (s.shape === 'answer') return answerBox(s.text);
  if (s.shape === 'plan') return planBox(s.text, cards);
  return md(s.text);
}
const words = text => splitShape(text).text;   // what is read aloud and shown in the closed band: no tag

// ── what waits for a manager (0276) ─────────────────────────────────────────
let mode = 'chat';   // 'chat' | 'waiting'  (the cards' settings are in Settings › Assistant since 19 Nov 2026)
let paintSeq = 0;    // a slow answer for a view that has been left must not draw under the one now shown
const backBtn = () => { const b = el('button', 'btn btn-sm btn-ghost', '← Back to the conversation'); b.onclick = () => { mode = 'chat'; paint(); }; return b; };

async function paintWaiting(my) {
  list.textContent = '';
  const f = ctx.farm();
  list.append(backBtn(), el('div', 'ai-impact-head', 'Waiting for you'));
  let cards = [];
  try { cards = await rpc('ai_cards_waiting', { p_farm: f.id }, { quiet: true }) || []; }
  catch (e) { if (my === paintSeq) list.append(el('div', 'ai-msg error', e.message)); return; }
  if (my !== paintSeq) return;
  if (!cards.length) list.append(el('div', 'ai-hello', 'Nothing is waiting for a decision.'));
  cards.forEach(k => {
    const box = el('div', 'ai-card open');
    box.append(el('div', 'ai-card-sum', k.summary || k.rpc), el('div', 'ai-card-state', (k.who || 'Someone') + ' asked' + (k.result ? ' — ' + k.result : '')));
    if (k.impact) box.append(impactBlock(k.impact));
    const row = el('div', 'row');
    const go = el('button', 'btn btn-sm btn-primary', 'Apply as me');
    const no = el('button', 'btn btn-sm btn-ghost', 'Dismiss');
    go.onclick = async () => {
      if (!ALLOWED.has(k.rpc)) { toast('That change is not allowed from the assistant', 'bad'); return; }
      go.disabled = true;
      try { await rpc(k.rpc, k.rpc === 'apply_batch_adjustment' ? { ...k.args, p_card: k.card_id } : k.args); toast('Applied: ' + (k.summary || k.rpc), 'ok'); ctx.refresh(); }
      catch (e) { toast(e.message, 'bad'); }
      paint();
    };
    no.onclick = async () => {
      try { await rpc('ai_card_decide', { p_card: k.card_id, p_state: 'dismissed' }, { quiet: true }); ctx.refresh(); } catch (e) { toast(e.message, 'bad'); }
      paint();
    };
    row.append(go, no); box.append(row); list.append(box);
  });
}

function paint() {
  const my = ++paintSeq;
  if (mode === 'waiting') { paintWaiting(my); return; }
  const c = convo();
  list.textContent = '';
  if (!c.view.length && !sending) {
    list.append(el('div', 'ai-hello', ctx.farm() ? 'Ask, or tell it what to set up. Changes come as cards: nothing happens until you press Do it.' : 'Choose a FarmBox first.'));
  }
  c.view.forEach((v, i) => list.append(item(v, i, c.view)));
  list.scrollTop = list.scrollHeight;
  paintTitle(); paintPeek(); paintContext();
}

function item(v, i, view = []) {
  if (v.role === 'user') {
    const b = el('div', 'ai-msg user');
    // the page the question was about (P2): a small chip; a click goes back there
    const pg = v.page && (v.page.title || v.page.route);
    if (pg) {
      const chip = el('button', 'ai-page-chip', pg + (v.page.units?.length ? ' · ' + v.page.units.join(' + ') : ''));
      chip.type = 'button'; chip.title = 'Asked about this page — click to open it';
      chip.onclick = () => { if (v.page.route && location.hash.split('?')[0] !== v.page.route) location.hash = v.page.route; };
      b.append(chip);
    }
    b.append(el('div', null, v.text));
    if (v.files?.length) b.append(el('div', 'ai-files', '📎 ' + v.files.join(', ')));
    return b;
  }
  if (v.role === 'error') return el('div', 'ai-msg error', v.text);
  // no face beside the assistant's words since the compact band (19 Nov 2026, owner)
  if (v.role === 'assistant') {
    const b = el('div', 'ai-msg bot'); b.append(drawAnswer(v.text, cardsAfter(view, i)));
    const r = el('button', 'ai-read'); r.type = 'button'; r.innerHTML = SPEAKER;   // read this answer aloud, all of it
    r.title = 'Read aloud (click again to stop)'; r.setAttribute('aria-label', 'Read this answer aloud');
    r.onclick = () => mic?.read(words(v.text), 0, true);
    b.append(r); return b;
  }
  if (v.role === 'action') return card(v, i);
  return el('div');
}

// ── what the change would do (0.8.0: public.impact_of, a dry run that is rolled back) ──────────────────────────────
// a table in the words of the people who use the console: [one, many]
const NOUN = {
  crop_plan: ['batch', 'batches'], growing_position: ['position', 'positions'], growing_system: ['zone', 'zones'],
  task: ['task', 'tasks'], task_item: ['task step', 'task steps'], sales_order: ['order', 'orders'],
  sales_order_line: ['order line', 'order lines'], farm_holiday: ['closed day', 'closed days'], steady_group: ['steady group', 'steady groups'],
  issue: ['issue', 'issues'], asset: ['piece of equipment', 'pieces of equipment'], maintenance_rule: ['maintenance routine', 'maintenance routines'],
  market_price: ['price', 'prices'], sop: ['procedure', 'procedures'], crop: ['crop', 'crops'],
  crop_phase: ['phase of the cycle', 'phases of the cycle'], crop_phase_sop: ['procedure on a phase', 'procedures on phases'],
  crop_task_template: ['task template', 'task templates'], crop_bom: ['material line', 'material lines'],
  crop_system_compat: ['growing-system fit', 'growing-system fits'], crop_target: ['climate target', 'climate targets'],
};
const noun = (t, n) => (NOUN[t] || [t.replace(/_/g, ' '), t.replace(/_/g, ' ') + ' rows'])[n === 1 ? 0 : 1];
const CLASS_NOTE = { A: 'records a fact', B: 'adjusts one batch', C: 'touches other work', D: 'changes a definition' };
const label = c => String(c).replace(/_/g, ' ');
const val = x => (x == null || x === '' ? '—' : String(x).length > 24 ? String(x).slice(0, 22) + '…' : String(x));

// the first example of a group, as "status active → cancelled" or the batch code created
function example(g) {
  const s = g.sample && g.sample[0];
  if (!s) return '';
  if (g.op === 'change') {
    const keys = Object.keys(s.to || {}).filter(k => JSON.stringify(s.to[k]) !== JSON.stringify((s.from || {})[k]));
    return keys.slice(0, 3).map(k => `${label(k)} ${val((s.from || {})[k])} → ${val(s.to[k])}`).join(', ');
  }
  const o = s.to && Object.keys(s.to).length ? s.to : s.from || {};
  return o.batch_code || o.title || o.name || o.code || o.day || '';
}

function impactBlock(imp) {
  const box = el('div', 'ai-impact');
  if (imp.ok === false) {
    box.classList.add('bad');
    box.append(el('div', 'ai-impact-head', imp.tooBig ? 'Too big to preview' : 'Would be refused'),
               el('div', 'ai-impact-line', imp.error || ''));
    if (imp.tooBig) box.append(el('div', 'ai-impact-line', 'The check changed nothing. You can still press Do it.'));
    return box;
  }
  const groups = (imp.changes || []).filter(g => !g.quiet);
  const head = el('div', 'ai-impact-head', groups.length ? 'What it would do' : 'No row would change');
  if (imp.class) { const c = el('span', 'ai-impact-class', 'class ' + imp.class); c.title = CLASS_NOTE[imp.class] || ''; head.append(' ', c); }
  box.append(head);
  const list = el('ul', 'ai-impact-list');
  groups.forEach(g => {
    const mark = g.op === 'create' ? '+' : g.op === 'remove' ? '−' : '~';
    const verb = g.op === 'create' ? 'creates' : g.op === 'remove' ? (g.table === 'crop_plan' ? 'cancels or deletes' : 'removes') : 'changes';
    const li = el('li', 'ai-impact-' + g.op);
    li.append(el('b', null, mark + ' '), `${verb} ${g.n} ${noun(g.table, g.n)}`);
    if (g.scope === 'other') li.append(el('span', 'ai-impact-warn', ' — in another FarmBox'));
    else if (g.scope === 'unknown') li.append(el('span', 'ai-impact-warn', ' — of a FarmBox that cannot be told'));
    else if (g.scope === 'shared') li.append(el('span', 'ai-impact-warn', ' — shared by the franchise'));
    const ex = g.scope === 'other' || g.scope === 'unknown' ? '' : example(g);
    if (ex) li.append(el('span', 'ai-impact-ex', ' (' + ex + ')'));
    list.append(li);
  });
  if (groups.length) box.append(list);
  if (imp.truncated) box.append(el('div', 'ai-impact-line', 'More changes than can be listed here.'));
  (imp.conflicts || []).forEach(c => box.append(el('div', 'ai-impact-conflict', '! ' + (typeof c === 'string' ? c : (c.rule ? c.rule + ' · ' : '') + (c.text || c.message || JSON.stringify(c))))));
  if (imp.needsManager) box.append(el('div', 'ai-impact-warn', 'This is more than the limit set for this FarmBox: a manager will decide it.'));
  return box;
}

function card(v) {
  const box = el('div', 'ai-card ' + (v.state || 'open'));
  box.append(el('div', 'ai-card-sum', v.summary || v.rpc));
  if (v.impact) box.append(impactBlock(v.impact));
  // a forked crop is a draft that carries ANOTHER crop's numbers (0277): the card says so, whatever the model wrote
  if (v.rpc === 'fork_crop') box.append(el('div', 'ai-impact-warn', 'This makes a draft crop, not an approved one. Its days, yields, climate targets and quantities are copied from the other crop and are not measured for this one: a person checks them and approves the crop in the crop library.'));
  const det = el('details', 'ai-card-det');
  det.append(el('summary', null, v.rpc), el('pre', null, JSON.stringify(v.args, null, 1)));
  box.append(det);
  if (v.state === 'done') box.append(el('div', 'ai-card-state ok', '✓ Done' + (v.result ? ' — ' + v.result : '')));
  else if (v.state === 'dismissed') box.append(el('div', 'ai-card-state', 'Dismissed'));
  else if (v.state === 'needs_manager') box.append(el('div', 'ai-card-state', '⏳ Waiting for a manager to decide' + (v.result ? ' — ' + v.result : '')));
  else if (v.state === 'failed') box.append(el('div', 'ai-card-state bad', '✕ ' + v.result));
  if (!v.state || v.state === 'failed') {
    const row = el('div', 'row');
    const go = el('button', 'btn btn-sm btn-primary', v.state === 'failed' ? 'Try again' : 'Do it');
    const no = el('button', 'btn btn-sm btn-ghost', 'Dismiss');
    go.onclick = () => doIt(v, go);
    no.onclick = () => { v.state = 'dismissed'; convo().notes.push(`dismissed: ${v.summary}`); record(v, 'dismissed'); save(); paint(); };
    row.append(go, no);
    box.append(row);
  }
  return box;
}

// what became of a card is kept with the conversation (0275); the change itself already ran through its own door, so a
// failure here changes nothing for the person
function record(v, state) {
  if (!v.card_id) return;
  rpc('ai_card_decide', { p_card: v.card_id, p_state: state, p_result: state === 'dismissed' ? null : (v.result || null) }, { quiet: true }).catch(() => { /* an old card, or offline */ });
}

const short = r => {
  if (r == null) return '';
  if (typeof r !== 'object') return String(r).slice(0, 80);
  const keys = ['crop', 'zone', 'positions', 'batches', 'validated', 'placed', 'title', 'name', 'version', 'status', 'batch', 'harvest_start'];
  return keys.filter(k => r[k] != null).map(k => `${k} ${r[k]}`).join(' · ').slice(0, 120);
};

async function doIt(v, btn) {
  if (!ALLOWED.has(v.rpc)) { toast('That change is not allowed from the assistant', 'bad'); return; }
  const c = convo(), key = ckey();   // the page it was pressed on: a slow change must not write into the page shown by then
  btn.disabled = true; btn.textContent = 'Doing…';
  try {
    const r = await rpc(v.rpc, v.rpc === 'apply_batch_adjustment' ? { ...v.args, p_card: v.card_id || null } : v.args);
    if (r && r.needs_manager && !v.card_id) {   // the card was not kept, so nobody could be asked: say so, and leave it as it is
      toast(r.message || 'This is above the limit: ask a manager', 'bad');
      btn.disabled = false; btn.textContent = 'Do it'; return;
    }
    if (r && r.needs_manager) {   // above the limit: nothing was applied, the manager decides (the door has marked the card)
      v.state = 'needs_manager'; v.result = r.message || '';
      c.notes.push(`asked a manager: ${v.summary}`);
      toast('Sent to a manager: it is above the limit', 'ok');
      save(key); paint(); return;
    }
    v.state = 'done'; v.result = short(r);
    if (v.rpc !== 'apply_batch_adjustment') record(v, 'done');
    c.notes.push(`did: ${v.summary}` + (v.result ? ` (${v.result})` : ''));
    toast('Done: ' + (v.summary || v.rpc), 'ok');
    ctx.refresh();
  } catch (e) {
    v.state = 'failed'; v.result = e.message;
    record(v, 'failed');
    c.notes.push(`tried "${v.summary}" and it failed: ${e.message}`);
  }
  save(key); paint();
}

let sending = false;   // one question at a time: Enter or a chip during an answer used to start a second one
// opts.check: the "To check" button — the person sees "To check", the assistant reads CHECK_ASK, and neither the files nor a
// dropped chip change it; opts.voice: asked by voice
// → { reply, cards } of the answer, for the voice to read out; null when nothing came back
async function send(text, opts = {}) {
  if (sending) {
    if (opts.voice) { if (!input.value.trim()) input.value = text || ''; toast('Still answering the last question: your words are in the box, press Send', ''); }   // what was said is not lost
    return null;
  }
  if (!opts.voice) mic?.hush();
  sending = true;   // before the first await: a second Enter, or a phrase, while the first reads the database is refused
  try { return await sendNow(text, opts); } finally { sending = false; }
}
async function sendNow(text, opts) {
  const c = convo(), key = ckey();
  const f = ctx.farm();
  text = (text ?? input.value).trim();
  if (!f) { if (opts.voice && !input.value.trim()) input.value = text; toast('Choose a FarmBox first', 'bad'); return null; }
  if (!text && !files.length) return null;
  if (mode !== 'chat') { mode = 'chat'; paint(); }
  if (closed()) setFrac(AUTO);   // a question slides the band open to a fifth of the screen (owner, 19 Nov 2026)
  const sent = opts.check ? [] : files.slice();
  if (!opts.check) { files = []; paintFiles(); }
  if (!opts.check && !opts.voice) input.value = '';   // what was said does not wipe a half-typed draft
  const notes = c.notes.length ? `(Since your last answer I ${c.notes.join('; ')}.)\n` : '';
  // the page the question is about (P2): stamped on the question, sent to the function (its context line names it)
  const w = ctx.where?.() || {};
  const stamp = stampNow(c, w, opts.check);
  if (!opts.check) c.stamp = stamp;
  const allUnits = !opts.check && ctxOff.units && stamp.units?.length;   // the unit chip dropped: the whole site
  const where = allUnits ? '(This question is about the whole FarmBox, not only the units on screen.)\n' : '';
  const page = { route: stamp.route, title: stamp.title, units: allUnits ? [] : stamp.units || [] };
  const asked = opts.check ? CHECK_ASK : text;
  // the shape: To check is a check list (brief); a ticked chip is for this question only; none = auto (the model chooses,
  // a short answer for a plain question)
  const picked = shapePick, shape = opts.check ? 'brief' : picked || 'auto';
  if (!opts.check && picked) { shapePick = null; paintShapes(); }
  const messages = [...c.messages, { role: 'user', content: notes + where + (asked || 'Here is a file.') }];
  c.view.push({ role: 'user', text: text || '(a file)', files: sent.map(x => x.name), page });
  c.fresh = false;
  paint();
  busyRow.hidden = false; sendBtn.disabled = true; checkBtn.disabled = true; sending = true;
  let out = null;
  try {
    // the units it may read: those on screen (the unit chip left out = the whole site); none for a FarmBox that is alone
    const units = (allUnits ? stamp.allUnitIds : stamp.unitIds) || undefined;
    const r = await fn('assistant', { farm_id: f.id, units, route: stamp.route, page, messages, attachments: sent, chat_id: c.chatId || undefined, text: text || '(a file)', files: sent.map(x => x.name), shape }, { quiet: true });   // it only asks: what it proposes is done by a card
    if (!r?.ok) throw new Error(r?.error || 'The assistant did not answer');
    c.messages = r.messages;
    c.chatId = r.chat_id || null;
    c.notes = []; c.at = Date.now();
    if (r.reply) c.view.push({ role: 'assistant', text: r.reply });
    out = { reply: words(r.reply || ''), cards: (r.actions || []).length };
    (r.actions || []).forEach(a => c.view.push({ role: 'action', id: a.id, card_id: a.card_id || null, rpc: a.rpc, args: a.args, summary: a.summary, impact: a.impact || null }));
  } catch (e) {
    c.view.push({ role: 'error', text: e.message });
    if (ctx.farm()?.id === f.id) {   // the words, the attachments and the shape come back for another try
      if (text && !opts.check) input.value = text;
      if (!files.length) { files = sent; paintFiles(); }
      if (picked && !shapePick) { shapePick = picked; paintShapes(); }
    }
  }
  busyRow.hidden = true; sendBtn.disabled = false; checkBtn.disabled = false; sending = false;
  save(key); paint();
  if (closed() && ctx.farm()?.id === f.id && key === ckey()) setFrac(AUTO);   // closed meanwhile: the answer is here, show it
  // a typed question or To check: read aloud only when this device asks for every answer (a spoken one is read by the mic itself)
  if (out && !opts.voice && readAllOn() && key === ckey()) mic?.read(out.reply, out.cards);
  return out;
}

// the title of the conversation: the first words of its first question ("To check" when that was the button); before one,
// the name of the page. Beside it, how old the conversation is
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? '' : m < 1440 ? Math.round(m / 60) + ' h ago' : (d => d === 1 ? 'yesterday' : d + ' days ago')(Math.round(m / 1440));
};
function paintTitle() {
  if (!titleEl) return;
  const c = convo();
  const first = c.view.find(v => v.role === 'user' && v.text && v.text !== '(a file)');
  const words = first ? first.text.replace(/[?!.…:;,]+\s*$/g, '').split(/\s+/).filter(Boolean) : [];
  const t = words.length ? words.slice(0, 5).join(' ') : 'New chat';
  titleEl.textContent = t.charAt(0).toUpperCase() + t.slice(1);
  titleEl.title = first ? first.text : 'A new conversation';
  if (ageEl) ageEl.textContent = c.at && c.view.length ? ago(c.at) : '';
}

function paintFiles() {
  const box = band.querySelector('.ai-attached');
  box.textContent = '';
  files.forEach((f, i) => {
    const chip = el('span', 'ai-file', f.name + ' ✕');
    chip.title = 'Remove';
    chip.onclick = () => { files.splice(i, 1); paintFiles(); };
    box.append(chip);
  });
}

function readFile(file) {
  return new Promise((ok, bad) => {
    if (file.size > 8_000_000) { bad(new Error(`${file.name} is over 8 MB`)); return; }
    const r = new FileReader();
    r.onload = () => {
      const m = /^data:([^;]*);base64,(.*)$/.exec(String(r.result));
      const byExt = /\.xlsx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  : /\.xls$/i.test(file.name) ? 'application/vnd.ms-excel' : /\.csv$/i.test(file.name) ? 'text/csv' : '';
      ok({ name: file.name, media_type: file.type || byExt || (m && m[1]) || 'application/octet-stream', data: m ? m[2] : '' });
    };
    r.onerror = () => bad(r.error);
    r.readAsDataURL(file);
  });
}

// ── the band's height ─────────────────────────────────────────────────────────────────────────────────────────────
// a fraction of the window's height, so a third stays a third on a bigger screen; 0 is closed
const AUTO = 0.2, SNAPS = [0, AUTO, 1 / 3, 0.5], MAX = 0.6;
let frac = 0, lastOpen = AUTO;
const bandKey = () => `fbc_band_${ctx.user?.() || 'none'}_${screen.width}x${screen.height}`;
const closed = () => frac === 0;
function setFrac(f, keep = true) {
  frac = Math.max(0, Math.min(MAX, f));
  if (frac > 0) lastOpen = frac;
  band.classList.toggle('closed', frac === 0);
  if (frac === 0) mic?.cancel();   // closed: nothing keeps recording or reading unseen
  band.style.height = frac === 0 ? '' : Math.round(frac * innerHeight) + 'px';
  grip.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  grip.title = frac === 0 ? 'Click to open the assistant, or drag it down' : 'Click to close the assistant, or drag to make it taller or shorter';
  grip.setAttribute('aria-expanded', String(frac > 0));
  if (keep) pref.set(bandKey(), JSON.stringify({ f: frac, open: lastOpen }));
  if (frac > 0) list.scrollTop = list.scrollHeight;
}
function loadFrac() {
  let v = null;
  try { v = JSON.parse(pref.get(bandKey()) || 'null'); } catch { /* none */ }
  lastOpen = v && v.open > 0 ? Math.min(MAX, v.open) : AUTO;
  setFrac(v ? Number(v.f) || 0 : 0, false);
}
const snap = f => f < 0.12 ? 0 : SNAPS.reduce((a, x) => Math.abs(x - f) < Math.abs(a - f) ? x : a, SNAPS[1]);
function openBand() { setFrac(lastOpen || AUTO); }
function setOpen(open) {
  if (open) { if (closed()) openBand(); paint(); setTimeout(() => input.focus(), 30); mic?.warm(); }
  else setFrac(0);
}

function wireGrip() {
  let y0 = 0, h0 = 0, moved = false;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    y0 = e.clientY; h0 = band.getBoundingClientRect().height; moved = false;
    grip.setPointerCapture(e.pointerId);
    band.classList.add('dragging');
  });
  grip.addEventListener('pointermove', e => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientY - y0) > 3) moved = true;
    if (!moved) return;
    band.classList.remove('closed');
    band.style.height = Math.max(44, Math.min(MAX * innerHeight, h0 + e.clientY - y0)) + 'px';
  });
  const end = e => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    grip.releasePointerCapture(e.pointerId);
    band.classList.remove('dragging');
    // a click on the grip, not a drag: open to the last height, or close (owner, 19 Nov 2026)
    if (!moved) { if (e.type === 'pointerup') setOpen(closed()); return; }
    setFrac(snap(band.getBoundingClientRect().height / innerHeight));
    if (!closed()) paint();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(closed()); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const at = SNAPS.indexOf(snap(frac));
    setFrac(SNAPS[Math.max(0, Math.min(SNAPS.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]);
    if (!closed()) paint();
  });
  addEventListener('resize', () => { if (!closed()) band.style.height = Math.round(frac * innerHeight) + 'px'; });
}

// the chips beside the question: what is on screen goes with it, unless dropped
function paintContext() {
  if (!ctxRow) return;
  const w = ctx.farm() ? ctx.where?.() || {} : {};
  ctxRow.textContent = '';
  const chip = (key, text, title) => {
    const b = el('button', 'ai-ctx-chip' + (ctxOff[key] ? ' off' : ''), text);
    b.type = 'button';
    b.title = ctxOff[key] ? 'Left out of the question — click to send it again' : title + ' — click to leave it out';
    b.setAttribute('aria-pressed', String(!ctxOff[key]));
    b.onclick = () => { ctxOff[key] = !ctxOff[key]; paintContext(); };
    ctxRow.append(b);
  };
  if (w.units?.length) chip('units', w.units.join(' + '), 'The units on screen go with the question');
}

// the shape chips above the question (P1): Answer · Brief · Plan, at most one ticked, none = auto. Build (P5) is hidden
// until creation mode exists: SHAPE_CHIPS marks it so, and nothing else needs to change to show it
function paintShapes() {
  if (!shapeRow) return;
  shapeRow.querySelectorAll('.ai-shape:not(.ai-follow)').forEach(b => {
    const on = b.dataset.shape === shapePick;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function shapeChips() {
  const row = el('div', 'ai-shapes');
  row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'The shape of the answer (none ticked: the assistant chooses)');
  SHAPE_CHIPS.filter(c => !c.hidden).forEach(c => {
    const b = el('button', 'ai-shape', c.label);
    b.type = 'button'; b.dataset.shape = c.shape;
    b.title = c.title + ' — for the next question; untick for the assistant to choose (a short answer for a plain question)';
    b.onclick = () => { shapePick = shapePick === c.shape ? null : c.shape; paintShapes(); input?.focus(); };
    row.append(b);
  });
  // "Follow the page" (P2, on by default): off, the next questions stay about the page of the last question
  const follow = el('button', 'ai-shape ai-follow', 'Follow the page');
  follow.type = 'button';
  const paintFollow = () => {
    follow.classList.toggle('on', followPage); follow.setAttribute('aria-pressed', String(followPage));
    follow.title = followPage ? 'Each question is about the page on screen — click to keep the page of the last question'
      : 'The questions stay about the page of the last question — click to follow the page on screen again';
  };
  follow.onclick = () => { followPage = !followPage; paintFollow(); };
  paintFollow();
  row.append(el('div', 'spacer'), follow);
  return row;
}

// closed, the band says in one line what the assistant last said (or that it is thinking)
function paintPeek() {
  if (!peek) return;
  const last = mode === 'chat' ? [...convo().view].reverse().find(v => v.role === 'assistant') : null;
  peek.textContent = sending ? 'Reading the farm and thinking…'
    : last ? words(last.text).replace(/[*`#]/g, '').replace(/^\s*(?:[-•]\s+)?\[[+~=\-]\]\s*/gm, '').split('\n').find(l => l.trim()) || '' : '';   // no label and no hint (owner, 19 Nov 2026)
}

export function initAssistant(context) {
  ctx = context;
  band = document.getElementById('aiBand');
  const out = el('div', 'ai-out'), inn = el('div', 'ai-in');
  const head = el('div', 'ai-head');
  // the voice: one button in the question box, record by clicks (assistant-local.js)
  mic = createMic({ ask: t => send(t, { voice: true }) });
  titleEl = el('b', 'ai-title', 'New chat');
  ageEl = el('span', 'ai-age');
  peek = el('span', 'ai-peek');
  head.append(titleEl, ageEl, peek);
  list = el('div', 'ai-list');
  busyRow = el('div', 'ai-busy'); busyRow.hidden = true;
  const bar = el('div', 'loading-bar busy'); bar.append(el('i'));
  busyRow.append(el('span', 'hint', 'Reading the farm and thinking…'), bar);
  out.append(head, list, busyRow);

  ctxRow = el('div', 'ai-ctx');
  input = el('textarea', 'input ai-input');
  input.rows = 2;
  input.placeholder = 'Ask, or tell it what to set up…';
  input.setAttribute('aria-label', 'Ask the assistant');
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  fileIn = el('input'); fileIn.type = 'file'; fileIn.multiple = true; fileIn.hidden = true;
  fileIn.accept = 'image/*,.pdf,.xlsx,.xls,.csv';
  fileIn.onchange = async () => {
    for (const f of fileIn.files) { try { files.push(await readFile(f)); } catch (e) { toast(e.message, 'bad'); } }
    fileIn.value = ''; paintFiles();
  };
  const attach = el('button', 'btn btn-sm btn-ghost ai-attach', '📎');
  attach.title = 'Attach a picture, a PDF, an Excel or a CSV file';
  attach.setAttribute('aria-label', 'Attach a file');
  attach.onclick = () => fileIn.click();
  sendBtn = el('button', 'btn btn-sm btn-primary', 'Send');
  sendBtn.onclick = () => send();
  // "New chat": the conversation on screen is left (it stays in the database); the next question starts a new one
  const fresh = el('button', 'btn btn-sm btn-ghost ai-fresh', 'New chat');
  fresh.title = 'Start a new conversation';
  fresh.onclick = () => {
    if (sending) return;   // an answer on its way would land in a conversation that is gone
    mic.cancel(); mode = 'chat';
    convos.set(ckey(), { ...blank(), fresh: true, at: Date.now() }); save();   // the platform's older chat does not come back over it
    paint(); input.focus();
  };
  // "To check": what on this page needs checking — in place of the page summary that opened the band (owner, 19 Nov 2026)
  checkBtn = el('button', 'btn btn-sm ai-check', CHECK);
  checkBtn.title = 'Ask the assistant what on this page needs checking';
  checkBtn.onclick = () => send(CHECK, { check: true });
  const row = el('div', 'row ai-send'); row.append(attach, mic.button, mic.note, ctxRow, el('div', 'ai-attached'), el('div', 'spacer'), fresh, checkBtn, sendBtn);
  shapeRow = shapeChips();
  inn.append(shapeRow, input, row, fileIn);
  paintShapes();
  band.replaceChildren(out, inn);

  // the middle mouse button starts and stops the voice from anywhere on the page (not over a link or a field, where it keeps
  // its own job: a new tab, a paste). mousedown is stopped so that Windows does not begin its scroll-by-mouse
  // a middle drag dollies the 3D map and pans the photo viewer, so only a click that did not move counts, and never there
  const middle = e => e.button === 1 && band?.isConnected && ctx.farm() && !e.target.closest?.('a[href], input, textarea, select, canvas, .viewer');
  let mid = null;
  document.addEventListener('mousedown', e => { if (middle(e)) { e.preventDefault(); mid = { x: e.clientX, y: e.clientY }; } else mid = null; }, true);
  document.addEventListener('mouseup', e => {
    const d = mid; mid = null;
    if (d && e.button === 1 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) mic.toggle();
  }, true);
  document.addEventListener('auxclick', e => { if (middle(e)) e.preventDefault(); }, true);

  grip = el('div', 'ai-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', 'Height of the assistant');
  grip.setAttribute('aria-valuemin', '0'); grip.setAttribute('aria-valuemax', String(MAX * 100));
  grip.tabIndex = 0;
  grip.append(el('i'));
  band.after(grip);
  wireGrip();
  setFrac(0, false);
}

// signed in (or another person on this tab): their own height on this screen, their conversation
export function assistantReady() { mode = 'chat'; ctxOff = { page: false, units: false }; prune(); loadFrac(); paint(); }
// another page or another choice of units: the chips follow, and what was dropped comes back
// one conversation across pages (P2): the answers on screen stay as they are; only the chips follow the page
let shownKey = '';
export function assistantRouteChanged() {
  ctxOff = { page: false, units: false };
  const k = ckey();
  if (k !== shownKey) { shownKey = k; mic?.cancel(); if (band && mode === 'chat') { paint(); return; } }   // another person or FarmBox: its own conversation
  paintContext();
}

// a farm switch shows that farm's conversation
// sign-out: nothing of the last person's conversations stays in this tab (0.7.162)
// the dashboard's "To decide" tile for cards that wait for a manager opens them here
export function showAssistantWaiting() { mode = 'waiting'; setOpen(true); }
export function forgetAssistant() { mic?.destroy(); mode = 'chat'; convos.clear(); synced.clear(); followPage = true; if (band) { setFrac(0, false); paint(); } }
export function assistantFarmChanged() { mic?.cancel(); mode = 'chat'; if (band) paint(); }
