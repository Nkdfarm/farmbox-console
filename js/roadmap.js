// ═══════════════════════════════════════════════════════════════════════════
// Roadmap — the franchisor's company roadmap 2026–2027 (migration 0292)
//
// Tab 1 is a board: three lanes (tech, funding, new resources) by six periods.
// A block is dragged to another cell or another place in the same cell, a click
// opens its editor, the "+" at the foot of every cell adds one. Tab 2 is the
// open questions for the team, each with a "Team answer" that saves when you
// click away.
//
// Franchisor only: the database refuses anybody else (42501), app.js sends a
// non-franchisor who opens #/roadmap to the dashboard, and this page draws
// nothing for them either.
//
// Every change shows at once and is undone with a toast if the server refuses
// (the saved row, which carries the real id of a new one, replaces the guess).
// Ported from the approved standalone board; its sort order is a number that is
// always put between its neighbours' (orderFor), so one move writes one row.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, loading, pageHead, drawer, confirmDrawer, field, input, selectBox,
         toast, emptyState, isFranchisor } from './ui.js';

const PERIODS = ['May–Sep 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027'];
const LANES = [
  { id: 'tech', name: 'Build & Tech', sub: 'Naked Heart, AI, vision, robot' },
  // 0295 (owner, 22 Nov 2026): a lane of its own for how the produce and the franchise reach buyers; starts empty
  { id: 'market', name: 'Route to market', sub: 'customers, channels, sales, partners' },
  { id: 'fund', name: 'Funding & scale', sub: 'raise, FarmBox 2.0, new farms' },
  { id: 'res', name: 'New resources', sub: 'people and equipment' },
];
const STATUSES = [['planned', 'Planned'], ['proposed', 'Proposed'], ['built', 'Built'], ['key', 'Key date']];
// which years the board shows (owner, 22 Nov 2026: "a selection on top with 2026, 2027, both for a better 2027
// visual"): the columns of each choice; remembered on this computer, 2027 first
const YEARS = [['2026', '2026', [0, 1]], ['2027', '2027', [2, 3, 4, 5]], ['both', 'Both', [0, 1, 2, 3, 4, 5]]];
const YEAR_KEY = 'fbc_roadmap_years';
let years = (() => { try { const v = localStorage.getItem(YEAR_KEY); return YEARS.some(y => y[0] === v) ? v : '2027'; } catch { return '2027'; } })();
const shownCols = () => (YEARS.find(y => y[0] === years) || YEARS[1])[2];

let blocks = [];      // [{id, lane, col, ord, when, text, status, note, updated_at}]
let questions = [];   // [{id, ord, tag, title, context, answer, updated_at}]
let boardMount = null, qMount = null;
let drag = null, pendingPaint = false;
let tmpSeq = 0;

// ── load ───────────────────────────────────────────────────────────────────
async function load(mount, paint) {
  mount.textContent = '';
  mount.append(loading('Reading the roadmap…'));
  try {
    const d = await rpc('roadmap', {});
    if (!mount.isConnected) return false;
    blocks = (d?.blocks || []).map(b => ({ ...b, col: clampCol(b.col) }));
    questions = d?.questions || [];
    paint();
    return true;
  } catch (e) {
    if (!mount.isConnected) return false;
    mount.textContent = '';
    mount.append(el('div', 'note bad', e.message));
    return false;
  }
}
const clampCol = c => Math.max(0, Math.min(5, Number(c) || 0));
const notFranchisor = mount => { mount.textContent = ''; mount.append(el('div', 'note', 'The roadmap is for the franchisor.')); };

// ── the board ──────────────────────────────────────────────────────────────
export async function renderRoadmapBoard(container) {
  if (!isFranchisor()) return notFranchisor(container);
  boardMount = container;
  drag = null; pendingPaint = false;
  await load(container, paintBoard);
}

function nowCol() {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  if (y < 2026 || (y === 2026 && m < 9)) return 0;
  if (y === 2026) return 1;
  if (y === 2027) return 2 + Math.floor(m / 3);
  return 5;
}
const cellList = (lane, c) => blocks.filter(b => b.lane === lane && b.col === c).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
const byId = id => blocks.find(b => b.id === id);

// the number that puts a block before `beforeId` (or last) in its cell, between the neighbours' own
function orderFor(lane, c, beforeId, movingId) {
  const list = cellList(lane, c).filter(b => b.id !== movingId);
  if (!list.length) return 1000;
  if (!beforeId) return (list[list.length - 1].ord ?? 0) + 1000;
  const i = list.findIndex(b => b.id === beforeId);
  if (i <= 0) return (list[0].ord ?? 0) - 1000;
  return ((list[i - 1].ord ?? 0) + (list[i].ord ?? 0)) / 2;
}

function paintBoard() {
  if (!boardMount?.isConnected) return;
  if (drag?.active) { pendingPaint = true; return; }
  const nc = nowCol();
  const root = el('div', 'rm-page');

  const cols = shownCols();
  const seg = el('div', 'seg rm-years');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Years shown');
  for (const [key, label] of YEARS) {
    const b = el('button', 'seg-btn', label);
    b.type = 'button'; b.setAttribute('aria-pressed', String(key === years));
    b.onclick = () => {
      if (key === years) return;
      years = key;
      try { localStorage.setItem(YEAR_KEY, key); } catch { /* private window: the choice lasts this visit */ }
      paintBoard();
    };
    seg.append(b);
  }
  const span = years === '2026' ? 'May – Dec 2026' : years === '2027' ? 'Jan – Dec 2027' : 'May 2026 – Dec 2027';
  const head = pageHead(null, `${span} · tech, funding, resources · click a block to edit it, drag it to move it.`, seg);
  root.append(head);

  const legend = el('div', 'rm-legend');
  legend.setAttribute('aria-label', 'Legend');
  legend.append(el('span', 'rm-chip built', 'Built'), el('span', 'rm-chip', 'Planned'),
                el('span', 'rm-chip proposed', 'Proposed'), el('span', 'rm-chip key', 'Key date'));
  root.append(legend);

  const wrap = el('div', 'rm-wrap');
  const board = el('div', 'rm-board');
  // fewer columns, wider ones: four quarters of 2027 fill the width a six-column board shared
  board.style.gridTemplateColumns = `repeat(${cols.length}, minmax(${cols.length > 2 ? 170 : 220}px, 1fr))`;
  board.style.minWidth = `${cols.length * (cols.length > 2 ? 170 : 220)}px`;
  cols.forEach(i => {
    const h = el('div', 'rm-qh' + (i < nc ? ' past' : ''), PERIODS[i]);
    if (i === nc) h.append(el('span', 'rm-now', 'Now'));
    board.append(h);
  });
  for (const lane of LANES) {
    const lh = el('div', 'rm-lane ' + lane.id, lane.name);
    lh.append(el('span', null, lane.sub));
    board.append(lh);
    cols.forEach(c => {
      const cell = el('div', 'rm-cell');
      cell.dataset.lane = lane.id; cell.dataset.col = c;
      for (const b of cellList(lane.id, c)) cell.append(cardEl(b));
      const add = el('button', 'rm-add', '+');
      add.type = 'button';
      add.setAttribute('aria-label', `Add a block to ${lane.name}, ${PERIODS[c]}`);
      add.onclick = () => openBlock(null, { lane: lane.id, col: c });
      cell.append(add);
      board.append(cell);
    });
  }
  wrap.append(board);
  root.append(wrap);
  boardMount.replaceChildren(root);
}

function cardEl(b) {
  const kind = b.status === 'built' ? 'built' : b.status === 'key' ? 'key' : b.status === 'proposed' ? 'proposed' : '';
  const c = el('div', 'rm-card ' + kind);
  c.dataset.id = b.id; c.tabIndex = 0; c.setAttribute('role', 'button');
  c.title = (b.note ? b.note + '\n' : '') + 'Click to edit · drag to move';
  const grip = el('span', 'rm-grip', '⋮⋮');
  grip.setAttribute('aria-hidden', 'true');
  const t = el('span', 'rm-txt');
  if (b.when) t.append(el('b', null, b.when));
  t.append(document.createTextNode(b.text || ''));
  c.append(grip, t);
  c.addEventListener('pointerdown', e => startDrag(e, b.id, c));
  c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBlock(b.id); } });
  return c;
}

// ── drag and drop: pointer based; the mouse drags anywhere on a card, a finger by the grip ──
function startDrag(e, id, card) {
  if (e.button !== 0) return;
  if (e.pointerType !== 'mouse' && !e.target.closest('.rm-grip')) {
    card.addEventListener('pointerup', () => openBlock(id), { once: true });
    return;
  }
  drag = { id, el: card, startX: e.clientX, startY: e.clientY, active: false, target: null };
  card.setPointerCapture(e.pointerId);
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerup', onUp, { once: true });
  card.addEventListener('pointercancel', cleanupDrag, { once: true });
}
function onMove(e) {
  const d = drag; if (!d) return;
  if (!d.active) {
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
    d.active = true;
    d.ghost = d.el.cloneNode(true); d.ghost.classList.add('rm-ghost'); document.body.append(d.ghost);
    d.el.classList.add('dragging');
  }
  d.ghost.style.left = (e.clientX - 20) + 'px'; d.ghost.style.top = (e.clientY - 14) + 'px';
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under && under.closest('.rm-cell');
  document.querySelectorAll('.rm-cell.over').forEach(c => c !== cell && c.classList.remove('over'));
  document.querySelectorAll('.rm-marker').forEach(m => m.remove());
  d.target = null;
  if (!cell) return;
  cell.classList.add('over');
  const cards = [...cell.querySelectorAll('.rm-card')].filter(c => c !== d.el);
  let before = null;
  for (const c of cards) { const r = c.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = c; break; } }
  const m = el('div', 'rm-marker');
  cell.insertBefore(m, before || cell.querySelector('.rm-add'));
  d.target = { lane: cell.dataset.lane, col: Number(cell.dataset.col), beforeId: before?.dataset.id || null };
  const w = boardMount.querySelector('.rm-wrap'), r = w.getBoundingClientRect();
  if (e.clientX > r.right - 40) w.scrollLeft += 18; else if (e.clientX < r.left + 40) w.scrollLeft -= 18;
}
function cleanupDrag() {
  const d = drag; if (!d) return;
  d.el.removeEventListener('pointermove', onMove);
  d.ghost?.remove(); d.el.classList.remove('dragging');
  document.querySelectorAll('.rm-cell.over').forEach(c => c.classList.remove('over'));
  document.querySelectorAll('.rm-marker').forEach(m => m.remove());
  drag = null;
  if (pendingPaint) { pendingPaint = false; paintBoard(); }
}
function onUp() {
  const d = drag; if (!d) return;
  if (!d.active) { cleanupDrag(); openBlock(d.id); return; }
  const t = d.target, id = d.id;
  cleanupDrag();
  if (t) moveBlock(id, t.lane, t.col, t.beforeId);
}

// ── writes: show first, ask the server, put it back on a refusal ──
const isTmp = id => String(id).startsWith('tmp-');

function flash(id) {
  requestAnimationFrame(() => {
    const c = boardMount?.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
    if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
  });
}
function fail(e, what) { toast(`${what} did not save: ${e?.message || 'check your connection'}`, 'bad'); }

// change: the fields that change (an existing block) — a block that has no row yet is not changed
async function updateBlock(id, change) {
  const prev = byId(id);
  if (!prev || isTmp(id)) return false;
  const before = { ...prev };
  Object.assign(prev, change);
  paintBoard();
  try {
    const row = await rpc('roadmap_save_block', { p_block: { id, ...change } });
    const cur = byId(id);
    if (cur && row) Object.assign(cur, row, { col: clampCol(row.col) });
    flash(id);
    return true;
  } catch (e) {
    const cur = byId(id);
    if (cur) Object.assign(cur, before);
    paintBoard();
    fail(e, 'The change');
    return false;
  }
}
function moveBlock(id, lane, col, beforeId) {
  if (!byId(id)) return;
  updateBlock(id, { lane, col, ord: orderFor(lane, col, beforeId, id) });
}
async function createBlock(body) {
  const tmp = { ...body, id: 'tmp-' + (++tmpSeq), ord: orderFor(body.lane, body.col, null, null) };
  blocks.push(tmp);
  paintBoard();
  try {
    const row = await rpc('roadmap_save_block', { p_block: { lane: tmp.lane, col: tmp.col, ord: tmp.ord, when: tmp.when, text: tmp.text, status: tmp.status, note: tmp.note } });
    const i = blocks.indexOf(tmp);
    if (i >= 0 && row) blocks[i] = { ...row, col: clampCol(row.col) };
    paintBoard();
    if (row) flash(row.id);
  } catch (e) {
    blocks = blocks.filter(b => b !== tmp);
    paintBoard();
    fail(e, 'The new block');
  }
}
async function removeBlock(id) {
  const prev = byId(id);
  if (!prev || isTmp(id)) return;
  blocks = blocks.filter(b => b.id !== id);
  paintBoard();
  try { await rpc('roadmap_delete_block', { p_id: id }); }
  catch (e) { blocks.push(prev); paintBoard(); fail(e, 'The deletion'); }
}

// ── the block editor ──
function openBlock(id, preset) {
  const existing = id ? byId(id) : null;
  if (id && (!existing || isTmp(id))) return;
  const b = existing || { lane: 'tech', col: nowCol(), status: 'planned', when: '', text: '', note: '', ...preset };
  const d = drawer(existing ? 'Edit block' : 'Add block', `${LANES.find(l => l.id === b.lane)?.name || ''} · ${PERIODS[b.col]}`);

  const text = el('textarea');
  text.rows = 3; text.value = b.text || ''; text.placeholder = 'e.g. Heart 1.0: AI manual, build mode';
  const when = input({ value: b.when || '', placeholder: 'e.g. Feb' });
  const status = selectBox(STATUSES, b.status || 'planned');
  const lane = selectBox(LANES.map(l => [l.id, l.name]), b.lane);
  const col = selectBox(PERIODS.map((p, i) => [String(i), p]), String(b.col));
  const note = input({ value: b.note || '', placeholder: 'Source, owner, cost…' });
  const two = (a, c) => { const r = el('div', 'rm-row'); r.append(a, c); return r; };
  d.body.append(field('Text', text), two(field('When', when), field('Status', status)),
                two(field('Lane', lane), field('Quarter', col)), field('Note (optional)', note));

  const save = el('button', 'btn btn-primary', 'Save');
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = () => d.close();
  save.onclick = () => {
    const t = text.value.trim();
    if (!t) { text.focus(); return; }
    const body = { text: t, when: when.value.trim(), status: status.value, note: note.value.trim() };
    const l = lane.value, c = Number(col.value);
    d.close();
    if (existing) {
      const change = {};
      for (const k of Object.keys(body)) if (body[k] !== (existing[k] ?? '')) change[k] = body[k];
      if (existing.lane !== l || existing.col !== c) Object.assign(change, { lane: l, col: c, ord: orderFor(l, c, null, id) });
      if (Object.keys(change).length) updateBlock(id, change);
    } else createBlock({ ...body, lane: l, col: c });
  };
  if (existing) {
    const del = el('button', 'btn btn-danger', 'Delete');
    del.onclick = async () => {
      if (await confirmDrawer('Delete this block?', `"${existing.text}" is removed from the roadmap.`, 'Delete', true)) { d.close(); removeBlock(id); }
    };
    d.footer.append(del);
  }
  d.footer.append(el('div', 'spacer'), cancel, save);
}

// ── the questions ──────────────────────────────────────────────────────────
export async function renderRoadmapQuestions(container) {
  if (!isFranchisor()) return notFranchisor(container);
  qMount = container;
  await load(container, paintQuestions);
}

const qSorted = () => [...questions].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
const qById = id => questions.find(q => q.id === id);

function paintQuestions() {
  if (!qMount?.isConnected) return;
  // an answer being typed is not wiped: the other cards are refreshed in place
  const active = document.activeElement;
  if (active?.dataset?.qid && qMount.contains(active) && qMount.querySelectorAll('.rm-q').length === questions.length) {
    for (const card of qMount.querySelectorAll('.rm-q')) if (card.dataset.qid !== active.dataset.qid) updateQCard(card);
    return;
  }
  const root = el('div', 'rm-page');
  const add = el('button', 'btn btn-primary', '+ Add question');
  add.onclick = () => openQuestion(null);
  root.append(pageHead(null, "Before we commit. Write the team's answer under each question: it saves when you click away.", add));

  const list = qSorted();
  const grid = el('div', 'rm-qs');
  if (!list.length) root.append(emptyState('No open questions. Add one with + Add question.'));
  list.forEach((q, i) => {
    const card = el('article', 'rm-q');
    card.dataset.qid = q.id;
    const head = el('div', 'rm-q-head');
    const ed = el('button', 'rm-q-edit', 'Edit');
    ed.type = 'button';
    ed.onclick = () => openQuestion(q.id);
    head.append(el('span', 'rm-q-num', String(i + 1).padStart(2, '0')), el('span', 'rm-q-tag'), ed);
    const ctx = el('p', 'rm-q-ctx');
    const lab = el('div', 'field');
    const ta = el('textarea');
    ta.id = 'rm-ans-' + q.id; ta.dataset.qid = q.id;
    ta.placeholder = 'What did we decide? Who owns it, by when?';
    const l = el('label', null, 'Team answer'); l.htmlFor = ta.id;
    lab.append(l, ta);
    const saved = el('div', 'rm-q-saved');
    ta.addEventListener('change', () => saveAnswer(q.id, ta, saved));
    card.append(head, el('h3', null), ctx, lab, saved);
    updateQCard(card, q);
    grid.append(card);
  });
  if (list.length) root.append(grid);
  qMount.replaceChildren(root);
}
function updateQCard(card, q = qById(card.dataset.qid)) {
  if (!q) return;
  card.querySelector('.rm-q-tag').textContent = q.tag || '';
  card.querySelector('h3').textContent = q.title || '';
  const ctx = card.querySelector('.rm-q-ctx'); ctx.textContent = q.context || ''; ctx.hidden = !q.context;
  const ta = card.querySelector('textarea'); if (ta !== document.activeElement) ta.value = q.answer || '';
}

async function saveAnswer(id, ta, savedEl) {
  const q = qById(id);
  if (!q || isTmp(id)) return;
  const prev = q.answer;
  q.answer = ta.value;
  savedEl.textContent = 'Saving…';
  try {
    const row = await rpc('roadmap_save_question', { p_q: { id, answer: ta.value } });
    if (row?.updated_at) q.updated_at = row.updated_at;
    savedEl.textContent = 'Saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    q.answer = prev;
    if (ta.isConnected) ta.value = prev || '';
    savedEl.textContent = '';
    fail(e, 'The answer');
  }
}

function openQuestion(id) {
  const existing = id ? qById(id) : null;
  if (id && (!existing || isTmp(id))) return;
  const q = existing || { tag: '', title: '', context: '' };
  const d = drawer(existing ? 'Edit question' : 'Add question');
  const tag = input({ value: q.tag || '', placeholder: 'e.g. Funding' });
  const title = el('textarea');
  title.rows = 3; title.value = q.title || ''; title.placeholder = 'e.g. How much do we raise, and what comes first?';
  const ctx = el('textarea');
  ctx.rows = 3; ctx.value = q.context || ''; ctx.placeholder = 'What we know, what is missing';
  d.body.append(field('Topic', tag), field('Question', title), field('Why it is open (optional)', ctx));

  const save = el('button', 'btn btn-primary', 'Save');
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = () => d.close();
  save.onclick = async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const body = { tag: tag.value.trim(), title: t, context: ctx.value.trim() };
    d.close();
    if (existing) await updateQuestion(id, body); else await createQuestion(body);
  };
  if (existing) {
    const del = el('button', 'btn btn-danger', 'Delete');
    del.onclick = async () => {
      if (await confirmDrawer('Delete this question?', `"${existing.title}" and its team answer are removed.`, 'Delete', true)) { d.close(); removeQuestion(id); }
    };
    d.footer.append(del);
  }
  d.footer.append(el('div', 'spacer'), cancel, save);
}

async function updateQuestion(id, change) {
  const q = qById(id); if (!q) return;
  const before = { ...q };
  Object.assign(q, change);
  paintQuestions();
  try {
    const row = await rpc('roadmap_save_question', { p_q: { id, ...change } });
    if (row) Object.assign(q, row);
  } catch (e) { Object.assign(q, before); paintQuestions(); fail(e, 'The question'); }
}
async function createQuestion(body) {
  const last = qSorted().at(-1);
  const tmp = { ...body, answer: '', id: 'tmp-q' + (++tmpSeq), ord: (last?.ord ?? 0) + 1000 };
  questions.push(tmp);
  paintQuestions();
  try {
    const row = await rpc('roadmap_save_question', { p_q: { ord: tmp.ord, tag: tmp.tag, title: tmp.title, context: tmp.context, answer: '' } });
    const i = questions.indexOf(tmp);
    if (i >= 0 && row) questions[i] = row;
    paintQuestions();
  } catch (e) { questions = questions.filter(q => q !== tmp); paintQuestions(); fail(e, 'The question'); }
}
async function removeQuestion(id) {
  const prev = qById(id); if (!prev || isTmp(id)) return;
  questions = questions.filter(q => q.id !== id);
  paintQuestions();
  try { await rpc('roadmap_delete_question', { p_id: id }); }
  catch (e) { questions.push(prev); paintQuestions(); fail(e, 'The deletion'); }
}
