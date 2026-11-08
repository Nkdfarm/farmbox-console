// ═══════════════════════════════════════════════════════════════════════════
// The assistant — a side panel that helps set up and use the console
// (console 0.7.122, edge function `assistant`)
//
// A conversation per FarmBox. The assistant reads the farm as the person
// signed in (their permissions, nothing more) and answers; when it wants to
// change something it sends a card — what it would do, in one sentence — and
// nothing happens until the person presses "Do it", which runs the change as
// them, exactly like pressing the same button on the page would. It never
// validates a plan, approves anything or marks a task done. Pictures, PDFs,
// Excel and CSV files can be attached; the function reads them.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn } from './api.js';
import { el, toast, pref, g1Face } from './ui.js';

// the changes a card may carry — the same list the function accepts
const ALLOWED = new Set(['plan_position', 'plan_succession', 'steady_apply', 'move_batch', 'resize_batch', 'change_batch_crop',
  'cancel_crop_plan', 'set_batch_nursery', 'split_zone', 'clear_zone', 'save_order', 'plan_order_line', 'save_procedure',
  'save_crop', 'record_market_price', 'raise_issue', 'save_asset', 'save_maintenance_rule', 'save_farm_holiday', 'apply_batch_adjustment', 'fork_crop']);
const OPEN_KEY = 'fbc_ai_open';
const SUGGEST = [
  'Explain this page',
  'Plan a steady lettuce harvest in Zone 2',
  'Can we deliver 200 kg of basil in 8 weeks?',
  'Write the scouting report for today',
  'Import these prices from my spreadsheet',
];

let ctx = null;              // { farm(), refresh() } from app.js
let panel, list, input, sendBtn, fileIn, chips, busyRow;
const convos = new Map();    // farm id → { messages (as the function returned them), view, notes }
let files = [];

const convo = () => {
  const f = ctx.farm();
  const id = f?.id || 'none';
  if (!convos.has(id)) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('fbc_ai_' + id) || 'null'); } catch { /* none */ }
    convos.set(id, saved || { messages: [], view: [], notes: [], chatId: null, fresh: false });
  }
  return convos.get(id);
};
// id: the farm the conversation belongs to — an answer that lands after a switch of FarmBox is saved with its own
// conversation, not the one now on screen (review 3 Oct 2026)
const save = (id = ctx.farm()?.id) => {
  if (!id || !convos.has(id)) return;
  try {
    const s = JSON.stringify(convos.get(id));
    if (s.length < 3_000_000) localStorage.setItem('fbc_ai_' + id, s); else localStorage.removeItem('fbc_ai_' + id);
  } catch { /* private window, or full */ }
};

// a little markdown: paragraphs, **bold**, `code`, lists — escaped first
function md(text) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const box = el('div', 'ai-md');
  let html = '', listOpen = null;
  const close = () => { if (listOpen) { html += `</${listOpen}>`; listOpen = null; } };
  String(text || '').split(/\n/).forEach(line => {
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line), h = /^#{1,4}\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (listOpen !== kind) { close(); html += `<${kind}>`; listOpen = kind; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (h) { close(); html += `<p><b>${inline(h[1])}</b></p>`; }
    else if (!line.trim()) { close(); }
    else { close(); html += `<p>${inline(line)}</p>`; }
  });
  close();
  box.innerHTML = html;
  return box;
}

// ── what waits for a manager, and the farm's settings for the cards (0276) ─────────────────────────────────────────
let mode = 'chat';   // 'chat' | 'waiting' | 'settings'
let paintSeq = 0;    // a slow answer for a view that has been left must not draw under the one now shown
const backBtn = () => { const b = el('button', 'btn btn-sm btn-ghost', '← Back to the conversation'); b.onclick = () => { mode = 'chat'; paint(); }; return b; };

async function paintWaiting(my) {
  list.textContent = ''; chips.hidden = true;
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

async function paintSettings(my) {
  list.textContent = ''; chips.hidden = true;
  const f = ctx.farm();
  list.append(backBtn(), el('div', 'ai-impact-head', 'What the assistant\'s cards do on this FarmBox'));
  let s;
  try { s = await rpc('ai_settings', { p_farm: f.id }, { quiet: true }); } catch (e) { if (my === paintSeq) list.append(el('div', 'ai-msg error', e.message)); return; }
  if (my !== paintSeq) return;
  const form = el('div', 'ai-card open');
  const box = (label, on) => { const l = el('label', 'ai-set'); const i = el('input'); i.type = 'checkbox'; i.checked = !!on; i.disabled = !s.may_edit; l.append(i, ' ' + label); form.append(l); return i; };
  const num = (label, v) => { const l = el('label', 'ai-set'); const i = el('input', 'input'); i.type = 'number'; i.min = 0; i.placeholder = 'no limit'; i.value = v == null ? '' : v; i.disabled = !s.may_edit; l.append(label + ' ', i); form.append(l); return i; };
  const imp = box('Show what a change would do on each card', s.impact);
  const grow = box('A grower may apply a change to one running batch (class B)', s.class_b_growers);
  const days = num('Most days a reported harvest may differ from the forecast:', s.tolerance_days);
  const pct = num('Most % a reported yield may differ:', s.tolerance_yield_pct);
  form.append(el('div', 'ai-card-state', 'Empty means no limit. Above a limit the change waits for a manager or the agronomist.'));
  // learning from finished batches (0278): off until a manager turns it on, because the planner then uses what was learned
  form.append(el('div', 'ai-impact-head', 'Learning from finished batches'));
  const learn = box('Learn how long each phase really lasts from the dates observed on finished batches (once enough batches agree, the planner uses it for new batches)', s.learning);
  const ltol = num('Propose a change to a crop\'s phase days when they differ by more than (days):', s.learned_tolerance_days);
  form.append(el('div', 'ai-card-state', 'Empty means no proposals. A proposal waits in To decide for a manager or the agronomist; nothing changes until they accept it. Turning learning off goes back to each crop\'s own days.'));
  if (s.may_edit) {
    const save = el('button', 'btn btn-sm btn-primary', 'Save');
    save.onclick = async () => {
      save.disabled = true;
      try {
        await rpc('save_ai_settings', { p_farm: f.id, p: { impact: imp.checked, class_b_growers: grow.checked,
          tolerance_days: days.value === '' ? null : Number(days.value), tolerance_yield_pct: pct.value === '' ? null : Number(pct.value),
          learning: learn.checked, learned_tolerance_days: ltol.value === '' ? null : Number(ltol.value) } });
        toast('Saved', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      save.disabled = false;
    };
    form.append(save);
  } else form.append(el('div', 'ai-card-state', 'Only a manager of this FarmBox changes these.'));
  list.append(form);
}

function paint() {
  const my = ++paintSeq;
  if (mode === 'waiting') { paintWaiting(my); return; }
  if (mode === 'settings') { paintSettings(my); return; }
  const c = convo();
  list.textContent = '';
  if (!c.view.length) {
    list.append(el('div', 'ai-hello', 'Ask about this FarmBox, plan crops, change a procedure, import a spreadsheet or a photo of a list, or have a report written. Changes come as cards: nothing happens until you press Do it.'));
  }
  c.view.forEach((v, i) => list.append(item(v, i)));
  chips.hidden = !!c.view.length;
  list.scrollTop = list.scrollHeight;
}

function item(v, i) {
  if (v.role === 'user') {
    const b = el('div', 'ai-msg user');
    b.append(el('div', null, v.text));
    if (v.files?.length) b.append(el('div', 'ai-files', '📎 ' + v.files.join(', ')));
    return b;
  }
  if (v.role === 'error') return el('div', 'ai-msg error', v.text);
  // the assistant's own words carry its face, as a person's note carries theirs (0.7.239)
  if (v.role === 'assistant') { const r = el('div', 'ai-row'), b = el('div', 'ai-msg bot'); b.append(md(v.text)); r.append(g1Face('sm', 'The assistant'), b); return r; }
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

// the conversation of this person on this FarmBox, kept in the database, when this browser has none of its own
const hydrated = new Set();
async function hydrate() {
  const f = ctx.farm();
  if (!f || hydrated.has(f.id)) return;
  hydrated.add(f.id);
  const c = convo();
  if (c.view.length || c.fresh) return;   // `fresh`: the person pressed New conversation here; the old one is not brought back
  try {
    const r = await rpc('ai_chat_latest', { p_farm: f.id }, { quiet: true });
    if (r?.chat_id && !c.view.length && ctx.farm()?.id === f.id) {
      c.chatId = r.chat_id; c.messages = r.messages || []; c.view = r.view || [];
      save(f.id);
      if (!panel.hidden) paint();
    }
  } catch { /* offline, or the migration is not applied: the conversation stays in this browser */ }
}

const short = r => {
  if (r == null) return '';
  if (typeof r !== 'object') return String(r).slice(0, 80);
  const keys = ['crop', 'zone', 'positions', 'batches', 'validated', 'placed', 'title', 'name', 'version', 'status', 'batch', 'harvest_start'];
  return keys.filter(k => r[k] != null).map(k => `${k} ${r[k]}`).join(' · ').slice(0, 120);
};

async function doIt(v, btn) {
  if (!ALLOWED.has(v.rpc)) { toast('That change is not allowed from the assistant', 'bad'); return; }
  btn.disabled = true; btn.textContent = 'Doing…';
  try {
    const r = await rpc(v.rpc, v.rpc === 'apply_batch_adjustment' ? { ...v.args, p_card: v.card_id || null } : v.args);
    if (r && r.needs_manager && !v.card_id) {   // the card was not kept, so nobody could be asked: say so, and leave it as it is
      toast(r.message || 'This is above the limit: ask a manager', 'bad');
      btn.disabled = false; btn.textContent = 'Do it'; return;
    }
    if (r && r.needs_manager) {   // above the limit: nothing was applied, the manager decides (the door has marked the card)
      v.state = 'needs_manager'; v.result = r.message || '';
      convo().notes.push(`asked a manager: ${v.summary}`);
      toast('Sent to a manager: it is above the limit', 'ok');
      save(); paint(); return;
    }
    v.state = 'done'; v.result = short(r);
    if (v.rpc !== 'apply_batch_adjustment') record(v, 'done');
    convo().notes.push(`did: ${v.summary}` + (v.result ? ` (${v.result})` : ''));
    toast('Done: ' + (v.summary || v.rpc), 'ok');
    ctx.refresh();
  } catch (e) {
    v.state = 'failed'; v.result = e.message;
    record(v, 'failed');
    convo().notes.push(`tried "${v.summary}" and it failed: ${e.message}`);
  }
  save(); paint();
}

let sending = false;   // one question at a time: Enter or a chip during an answer used to start a second one
async function send(text) {
  if (sending) return;
  const c = convo();
  const f = ctx.farm();
  text = (text ?? input.value).trim();
  if (!f) { toast('Choose a FarmBox first', 'bad'); return; }
  if (!text && !files.length) return;
  if (mode !== 'chat') { mode = 'chat'; paint(); }
  const sent = files.slice(); files = []; paintFiles();
  input.value = '';
  const notes = c.notes.length ? `(Since your last answer I ${c.notes.join('; ')}.)\n` : '';
  const messages = [...c.messages, { role: 'user', content: notes + (text || 'Here is a file.') }];
  c.view.push({ role: 'user', text: text || '(a file)', files: sent.map(x => x.name) });
  paint();
  busyRow.hidden = false; sendBtn.disabled = true; sending = true;
  try {
    const r = await fn('assistant', { farm_id: f.id, route: location.hash, messages, attachments: sent, chat_id: c.chatId || undefined, text: text || '(a file)', files: sent.map(x => x.name) }, { quiet: true });   // it only asks: what it proposes is done by a card
    if (!r?.ok) throw new Error(r?.error || 'The assistant did not answer');
    c.messages = r.messages;
    c.chatId = r.chat_id || null;
    c.notes = [];
    if (r.reply) c.view.push({ role: 'assistant', text: r.reply });
    (r.actions || []).forEach(a => c.view.push({ role: 'action', id: a.id, card_id: a.card_id || null, rpc: a.rpc, args: a.args, summary: a.summary, impact: a.impact || null }));
  } catch (e) {
    c.view.push({ role: 'error', text: e.message });
    if (ctx.farm()?.id === f.id) { if (text) input.value = text; if (!files.length) { files = sent; paintFiles(); } }   // the attachments too
  }
  busyRow.hidden = true; sendBtn.disabled = false; sending = false;
  save(f.id); paint();
}

function paintFiles() {
  const box = panel.querySelector('.ai-attached');
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

function setOpen(open) {
  panel.hidden = !open;
  document.body.classList.toggle('ai-open', open);
  pref.set(OPEN_KEY, open ? '1' : null);
  if (open) { paint(); hydrate(); setTimeout(() => input.focus(), 30); }
}

export function initAssistant(context) {
  ctx = context;
  panel = el('aside', 'ai-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Assistant');
  const head = el('div', 'ai-head');
  const fresh = el('button', 'btn btn-sm btn-ghost', 'New conversation');
  fresh.onclick = () => { mode = 'chat'; const f = ctx.farm(); convos.set(f?.id || 'none', { messages: [], view: [], notes: [], chatId: null, fresh: true }); hydrated.add(f?.id); save(); paint(); };
  const x = el('button', 'btn btn-sm btn-ghost', '⟩');
  x.title = 'Fold the assistant away'; x.setAttribute('aria-label', 'Close the assistant');
  x.onclick = () => setOpen(false);
  const gear = el('button', 'btn btn-sm btn-ghost', '⚙');
  gear.title = 'What the cards do on this FarmBox'; gear.setAttribute('aria-label', 'Settings of the cards');
  gear.onclick = () => { mode = 'settings'; paint(); };
  head.append(g1Face('', 'The assistant'), el('b', null, 'Assistant'), el('div', 'spacer'), gear, fresh, x);
  list = el('div', 'ai-list');
  chips = el('div', 'ai-chips');
  SUGGEST.forEach(s => { const c = el('button', 'chip', s); c.onclick = () => send(s); chips.append(c); });
  busyRow = el('div', 'ai-busy'); busyRow.hidden = true;
  const bar = el('div', 'loading-bar busy'); bar.append(el('i'));
  busyRow.append(el('span', 'hint', 'Reading the farm and thinking…'), bar);
  const foot = el('div', 'ai-foot');
  input = el('textarea', 'input ai-input');
  input.rows = 3;
  input.placeholder = 'Ask, or tell it what to set up… (Enter to send, Shift+Enter for a new line)';
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  fileIn = el('input'); fileIn.type = 'file'; fileIn.multiple = true; fileIn.hidden = true;
  fileIn.accept = 'image/*,.pdf,.xlsx,.xls,.csv';
  fileIn.onchange = async () => {
    for (const f of fileIn.files) { try { files.push(await readFile(f)); } catch (e) { toast(e.message, 'bad'); } }
    fileIn.value = ''; paintFiles();
  };
  const attach = el('button', 'btn btn-sm btn-ghost', '📎');
  attach.title = 'Attach a picture, a PDF, an Excel or a CSV file';
  attach.onclick = () => fileIn.click();
  sendBtn = el('button', 'btn btn-sm btn-primary', 'Send');
  sendBtn.onclick = () => send();
  const row = el('div', 'row'); row.append(attach, el('div', 'ai-attached'), el('div', 'spacer'), sendBtn);
  foot.append(input, row, fileIn);
  panel.append(head, list, chips, busyRow, foot);
  document.body.append(panel);

  const btn = document.getElementById('aiBtn');
  if (btn) { btn.textContent = ''; btn.append(g1Face('xs', ''), 'Assistant'); btn.onclick = () => setOpen(panel.hidden); }
  if (pref.get(OPEN_KEY) === '1') setOpen(true);
}

// a farm switch shows that farm's conversation
// sign-out: nothing of the last person's conversations stays in this tab (0.7.162)
// the dashboard's "To decide" tile for cards that wait for a manager opens them here
export function showAssistantWaiting() { mode = 'waiting'; setOpen(true); }
export function forgetAssistant() { mode = 'chat'; convos.clear(); hydrated.clear(); if (panel && !panel.hidden) paint(); }
export function assistantFarmChanged() { mode = 'chat'; if (panel && !panel.hidden) { paint(); hydrate(); } }
