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
import { el, toast, pref } from './ui.js';

// the changes a card may carry — the same list the function accepts
const ALLOWED = new Set(['plan_position', 'plan_succession', 'plan_steady', 'move_batch', 'resize_batch', 'change_batch_crop',
  'cancel_crop_plan', 'set_batch_nursery', 'split_zone', 'clear_zone', 'save_order', 'plan_order_line', 'save_procedure',
  'save_crop', 'record_market_price', 'raise_issue', 'save_asset', 'save_maintenance_rule', 'save_farm_holiday']);
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
    convos.set(id, saved || { messages: [], view: [], notes: [] });
  }
  return convos.get(id);
};
const save = () => {
  const f = ctx.farm(); if (!f) return;
  try {
    const s = JSON.stringify(convo());
    if (s.length < 3_000_000) localStorage.setItem('fbc_ai_' + f.id, s); else localStorage.removeItem('fbc_ai_' + f.id);
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

function paint() {
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
  if (v.role === 'assistant') { const b = el('div', 'ai-msg bot'); b.append(md(v.text)); return b; }
  if (v.role === 'action') return card(v, i);
  return el('div');
}

function card(v) {
  const box = el('div', 'ai-card ' + (v.state || 'open'));
  box.append(el('div', 'ai-card-sum', v.summary || v.rpc));
  const det = el('details', 'ai-card-det');
  det.append(el('summary', null, v.rpc), el('pre', null, JSON.stringify(v.args, null, 1)));
  box.append(det);
  if (v.state === 'done') box.append(el('div', 'ai-card-state ok', '✓ Done' + (v.result ? ' — ' + v.result : '')));
  else if (v.state === 'dismissed') box.append(el('div', 'ai-card-state', 'Dismissed'));
  else if (v.state === 'failed') box.append(el('div', 'ai-card-state bad', '✕ ' + v.result));
  if (!v.state || v.state === 'failed') {
    const row = el('div', 'row');
    const go = el('button', 'btn btn-sm btn-primary', v.state === 'failed' ? 'Try again' : 'Do it');
    const no = el('button', 'btn btn-sm btn-ghost', 'Dismiss');
    go.onclick = () => doIt(v, go);
    no.onclick = () => { v.state = 'dismissed'; convo().notes.push(`dismissed: ${v.summary}`); save(); paint(); };
    row.append(go, no);
    box.append(row);
  }
  return box;
}

const short = r => {
  if (r == null) return '';
  if (typeof r !== 'object') return String(r).slice(0, 80);
  const keys = ['crop', 'zone', 'positions', 'batches', 'validated', 'placed', 'title', 'name', 'version', 'status'];
  return keys.filter(k => r[k] != null).map(k => `${k} ${r[k]}`).join(' · ').slice(0, 120);
};

async function doIt(v, btn) {
  if (!ALLOWED.has(v.rpc)) { toast('That change is not allowed from the assistant', 'bad'); return; }
  btn.disabled = true; btn.textContent = 'Doing…';
  try {
    const r = await rpc(v.rpc, v.args);
    v.state = 'done'; v.result = short(r);
    convo().notes.push(`did: ${v.summary}` + (v.result ? ` (${v.result})` : ''));
    toast('Done: ' + (v.summary || v.rpc), 'ok');
    ctx.refresh();
  } catch (e) {
    v.state = 'failed'; v.result = e.message;
    convo().notes.push(`tried "${v.summary}" and it failed: ${e.message}`);
  }
  save(); paint();
}

async function send(text) {
  const c = convo();
  const f = ctx.farm();
  text = (text ?? input.value).trim();
  if (!f) { toast('Choose a FarmBox first', 'bad'); return; }
  if (!text && !files.length) return;
  const sent = files.slice(); files = []; paintFiles();
  input.value = '';
  const notes = c.notes.length ? `(Since your last answer I ${c.notes.join('; ')}.)\n` : '';
  const messages = [...c.messages, { role: 'user', content: notes + (text || 'Here is a file.') }];
  c.view.push({ role: 'user', text: text || '(a file)', files: sent.map(x => x.name) });
  paint();
  busyRow.hidden = false; sendBtn.disabled = true;
  try {
    const r = await fn('assistant', { farm_id: f.id, route: location.hash, messages, attachments: sent });
    if (!r?.ok) throw new Error(r?.error || 'The assistant did not answer');
    c.messages = r.messages;
    c.notes = [];
    if (r.reply) c.view.push({ role: 'assistant', text: r.reply });
    (r.actions || []).forEach(a => c.view.push({ role: 'action', id: a.id, rpc: a.rpc, args: a.args, summary: a.summary }));
  } catch (e) {
    c.view.push({ role: 'error', text: e.message });
    if (text) input.value = text;
  }
  busyRow.hidden = true; sendBtn.disabled = false;
  save(); paint();
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
  if (open) { paint(); setTimeout(() => input.focus(), 30); }
}

export function initAssistant(context) {
  ctx = context;
  panel = el('aside', 'ai-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Assistant');
  const head = el('div', 'ai-head');
  const fresh = el('button', 'btn btn-sm btn-ghost', 'New conversation');
  fresh.onclick = () => { const f = ctx.farm(); convos.set(f?.id || 'none', { messages: [], view: [], notes: [] }); save(); paint(); };
  const x = el('button', 'btn btn-sm btn-ghost', '⟩');
  x.title = 'Fold the assistant away'; x.setAttribute('aria-label', 'Close the assistant');
  x.onclick = () => setOpen(false);
  head.append(el('b', null, '✦ Assistant'), el('div', 'spacer'), fresh, x);
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
  if (btn) btn.onclick = () => setOpen(panel.hidden);
  if (pref.get(OPEN_KEY) === '1') setOpen(true);
}

// a farm switch shows that farm's conversation
export function assistantFarmChanged() { if (panel && !panel.hidden) paint(); }
