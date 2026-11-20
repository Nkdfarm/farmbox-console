// ═════════════════════════════════════════════════════════════════════
// The history strip (owner, 21 Nov 2026: "the time line has to be built in a more visual way as CAD soft … just under
// the AI boxes with a small arrow to collapse/hide, you could open it without opening the full AI boxes"). Console 0.22.00.
//
// A thin strip under the assistant's band on every page, like Fusion 360's or SolidWorks' feature timeline: the operation
// log (0286, public.operations) oldest left → newest right, one icon per line (op-glyphs.js: a glyph per kind of object,
// a badge per verb), status by outline AND shape (orange double ring = class B, red with ! = failed, greyed and struck =
// put back, a lock = final, dashed = waits for a manager), an AI build in a violet bracket (folds to one icon), a date
// tick between days, the same command on the same object in a row collapsed (✎×12, opens on a click).
//   - folded by default, kept per person and device (fbc_tl_open_<user>); folded it says "N changes today";
//   - setup changes only by default ("All" adds the routine records), "This page" keeps the lines of the page on screen;
//   - hover: what, who, the actor, when; a click: the same detail and actions as Dashboard › Timeline (op-actions.js);
//   - the marker (Fusion's rollback bar), dragged or moved with the arrow keys, rolls nothing back: everything after it
//     is marked, and "Revert from here…" lists every line after it newest first, says which stay and why, asks, then puts
//     them back newest first, stopping at the first refusal, and says what was and was not put back;
//   - ▶ replays from the marker (or the start): each line's page opened and its button highlighted (ai-build-ui.js's
//     replay), its tooltip shown, one every 1.5 s; ■ stops. It never clicks or changes anything.
// Reads the units on screen (the unit selector), again after a change through the registry (op-actions' onOperation),
// on a change of unit or FarmBox, and on a page change when the copy is over a minute old.
// ═════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, toast, confirmDrawer, drawer, farmWhen, farmDayOf, farmToday, pref } from './ui.js';
import { getCommand, ACTORS_LOGGED } from './registry.js';
import { glyphOf, glyphSvg, glyphLabel } from './op-glyphs.js';
import { visibleOps, buildItems, flatOps, markerStops, nearestStop, afterMarker, revertPlan, revertUnits, conflictsOf, countToday } from './op-history.js';
import { FAMILY, titleOf, notesOf, actionsOf, revertOne, conflictText, say, missing, here, onOperation, notifyOperations } from './op-actions.js';
import { navigate, locate, highlight } from './ai-build-ui.js';

const LIMIT = 200, STEP_MS = 1500, STALE_MS = 60000;
const ROUTE = /^#\/[a-z0-9_/-]*$/;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG = {
  fold: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>',
  first: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2.5v7"/><path d="M9.5 2.5L5 6l4.5 3.5z" class="g-solid"/></svg>',
  back: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8.5 2.5L4 6l4.5 3.5z" class="g-solid"/></svg>',
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.2v7.6L9.8 6z" class="g-solid"/></svg>',
  stop: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3" y="3" width="6" height="6" class="g-solid"/></svg>',
  fwd: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2.5L8 6l-4.5 3.5z" class="g-solid"/></svg>',
  last: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9 2.5v7"/><path d="M2.5 2.5L7 6l-4.5 3.5z" class="g-solid"/></svg>',
  lock: '<svg class="tls-lock" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="4.4" width="6" height="4.4" rx="1" class="g-solid"/><path d="M3.4 4.4V3.2a1.6 1.6 0 0 1 3.2 0v1.2"/></svg>',
  group: '<svg class="tls-glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M5.5 3h7.5a.5.5 0 0 1 .5.5V11"/></svg>',
};

let ctx = null, root = null;
let opts = { open: false, all: false, thisPage: false }, user = null;
let ops = [], groups = {}, readKey = '', readAt = 0, state = 'idle', errText = '';
let items = [], flat = [], marker = null, selId = null;
const expanded = new Set(), folded = new Set();
let play = null, tip = null, pop = null, again = null, reading = null;

const route = () => (typeof location !== 'undefined' ? (location.hash || '').split('?')[0] : '');
const dayOf = iso => farmDayOf(new Date(iso));
const unitsOf = () => { const f = ctx?.farm(); if (!f) return []; const w = ctx.where?.() || {}; return w.unitIds?.length ? w.unitIds : [f.id]; };
const farmFor = id => { const f = ctx?.farm(); return (f?.units || []).find(u => u.id === id) || f; };
const pagesOf = c => getCommand(c)?.pages || [];
const posOf = () => (marker == null ? flat.length : Math.min(marker, flat.length));

// ── start, page, person ────────────────────────────────────────────────────────────────────────────────────────────
export function initStrip(context) {
  ctx = context;
  root = document.getElementById('tlStrip');
  if (!root) return;
  root.classList.add('tls-strip');   // its own prefix: tl- is the crop planner's
  onOperation(() => { clearTimeout(again); again = setTimeout(() => read(true), 900); });
  // the person opens another page during a replay: the replay stops (its own navigate sets play.hash first)
  window.addEventListener('hashchange', () => { if (play && route() !== play.hash) stopPlay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (pop || tip)) { closePop(); hideTip(); } });
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !e.target.closest?.('.tls-node')) closePop(); }, true);
  paint();
}
// a page, a unit or a FarmBox changed (app.js, beside the assistant's)
export function stripRouteChanged() {
  if (!root || play) return;          // the replay opens pages itself: the strip stays as it was until it stops
  const u = ctx.user?.() || null;
  if (u !== user) { user = u; loadOpts(); }
  closePop(); hideTip();
  const key = `${ctx.farm()?.id || ''}|${unitsOf().join(',')}`;
  if (key !== readKey || Date.now() - readAt > STALE_MS) read(key !== readKey);
  else refilter();
}
// sign-out: nothing of the last person's log stays
export function forgetStrip() {
  stopPlay(); closePop(); hideTip();
  clearTimeout(again); reading = null;   // an answer still on its way lands nowhere
  ops = []; groups = {}; readKey = ''; state = 'idle'; marker = null; selId = null; user = null; expanded.clear(); folded.clear();
  if (root) paint();
}

function loadOpts() {
  const k = user || 'anon';
  opts.open = pref.get('fbc_tl_open_' + k) === '1';
  try { const o = JSON.parse(pref.get('fbc_tl_opts_' + k) || '{}'); opts.all = !!o.all; opts.thisPage = !!o.thisPage; } catch { opts.all = false; opts.thisPage = false; }
}
function saveOpts() {
  const k = user || 'anon';
  pref.set('fbc_tl_open_' + k, opts.open ? '1' : '0');
  pref.set('fbc_tl_opts_' + k, JSON.stringify({ all: opts.all, thisPage: opts.thisPage }));
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function read(fresh = false) {
  const f = ctx?.farm();
  if (!f || !root) return;
  const ids = unitsOf(), key = `${f.id}|${ids.join(',')}`;
  if (fresh && key !== readKey) { marker = null; selId = null; expanded.clear(); folded.clear(); }
  const mine = reading = Symbol('read');
  if (state === 'idle') paint();   // "Reading…" the first time
  try {
    const answers = await Promise.all(ids.map(id => rpc('operations', { p_farm: id, p_limit: LIMIT }, { quiet: true })));
    if (mine !== reading) return;
    const byId = new Map();
    groups = {};
    answers.forEach(a => { (a?.ops || []).forEach(o => byId.set(o.id, o)); Object.assign(groups, a?.groups || {}); });
    ops = [...byId.values()].sort((a, b) => b.seq - a.seq);
    state = 'ok'; errText = '';
  } catch (e) {
    if (mine !== reading) return;
    state = missing(e) ? 'missing' : 'error'; errText = say(e); ops = [];
  }
  readKey = key; readAt = Date.now();
  if (play) return;
  refilter();
}
function refilter() {
  const chrono = visibleOps(ops, { all: opts.all, thisPage: opts.thisPage, route: route(), pagesOf });
  items = buildItems(chrono, { dayOf, expanded, folded });
  flat = flatOps(items);
  if (marker != null && marker >= flat.length) marker = null;
  if (marker != null) marker = nearestStop(items, marker);
  if (selId && !flat.some(o => o.id === selId)) selId = null;
  paint();
}

// ── drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────
function iconBtn(svg, label, cls = '') {
  const b = el('button', 'tls-btn ' + cls);
  b.type = 'button';
  b.innerHTML = svg;   // constants only
  b.setAttribute('aria-label', label); b.title = label;
  return b;
}
function paint() {
  if (!root) return;
  hideTip();
  // the track keeps where it was scrolled to; at the end (the newest) it stays at the end
  const old = root.querySelector('.tls-track');
  const keep = old && old.scrollWidth - old.clientWidth - old.scrollLeft > 4 ? old.scrollLeft : null;
  root.textContent = '';
  root.classList.toggle('is-open', opts.open);
  const fold = iconBtn(SVG.fold, opts.open ? 'Fold the history' : 'Open the history', 'tls-fold');
  fold.setAttribute('aria-expanded', String(opts.open));
  fold.setAttribute('aria-controls', 'tlBody');
  fold.onclick = () => { opts.open = !opts.open; saveOpts(); if (!opts.open) { stopPlay(); closePop(); } paint(); root.querySelector('.tls-fold')?.focus(); };
  root.append(fold);
  if (!opts.open) {
    const label = el('button', 'tls-label', 'History');
    label.type = 'button'; label.onclick = fold.onclick;
    root.append(label);
    if (state === 'ok') {
      const n = countToday(flat, farmToday(), dayOf);
      root.append(el('span', 'tls-badge' + (n ? '' : ' is-zero'), `${n} change${n === 1 ? '' : 's'} today`));
    }
    return;
  }
  const body = el('div', 'tls-body');
  body.id = 'tlBody';
  body.append(controls());
  const track = el('div', 'tls-track');
  track.setAttribute('role', 'list');
  track.setAttribute('aria-label', 'Changes, oldest first');
  if (state === 'missing') track.append(el('span', 'tls-empty', 'The operation log is not set up on this platform yet.'));
  else if (state === 'error') track.append(el('span', 'tls-empty bad', 'Could not read the history: ' + errText));
  else if (state !== 'ok') track.append(el('span', 'tls-empty', 'Reading…'));
  else if (!flat.length) track.append(el('span', 'tls-empty', opts.thisPage ? 'Nothing changed from this page yet.' : opts.all ? 'Nothing in the log yet.' : 'No setup change yet (All shows every line).'));
  else drawTrack(track);
  body.append(track, options());
  root.append(body);
  track.scrollLeft = keep ?? track.scrollWidth;
  // a mouse wheel scrolls the strip sideways (its scroll bar is hidden: 34 px leave no room for one)
  track.onwheel = e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && track.scrollWidth > track.clientWidth) { e.preventDefault(); track.scrollLeft += e.deltaY; } };
}

function controls() {
  const bar = el('div', 'tls-ctrls');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'History controls');
  const n = flat.length, stops = markerStops(items), p = posOf();
  const move = to => { marker = to >= n ? null : to; paint(); focusMarker(); };
  const first = iconBtn(SVG.first, 'Marker to the start', 'tls-hide-phone');
  first.onclick = () => move(0);
  const back = iconBtn(SVG.back, 'Marker one change back');
  back.onclick = () => move([...stops].reverse().find(s => s < p) ?? 0);
  const playB = iconBtn(play ? SVG.stop : SVG.play, play ? 'Stop the replay' : 'Replay from the marker', 'tls-play' + (play ? ' is-on' : ''));
  playB.setAttribute('aria-pressed', String(!!play));
  playB.onclick = () => (play ? stopPlay() : startPlay());
  const fwd = iconBtn(SVG.fwd, 'Marker one change forward');
  fwd.onclick = () => move(stops.find(s => s > p) ?? n);
  const last = iconBtn(SVG.last, 'Marker to the end (nothing after it)', 'tls-hide-phone');
  last.onclick = () => move(n);
  [first, back, playB, fwd, last].forEach(b => { b.disabled = !n && b !== playB; });
  playB.disabled = !n;
  bar.append(first, back, playB, fwd, last);
  return bar;
}

function options() {
  const box = el('div', 'tls-opts');
  const toggle = (label, short, key, title) => {
    const b = el('button', 'tls-toggle');
    b.type = 'button';
    b.append(el('span', 'tls-long', label), el('span', 'tls-short', short));
    b.title = title;
    b.setAttribute('aria-pressed', String(opts[key]));
    b.onclick = () => { opts[key] = !opts[key]; saveOpts(); marker = null; refilter(); };
    return b;
  };
  box.append(toggle('All', 'All', 'all', 'Every line, routine records too (runs, orders, issues, prices); off: setup changes only'),
    toggle('This page', 'Page', 'thisPage', 'Only the changes made from, or for, the page on screen'));
  const after = afterMarker(items, posOf());
  const will = revertPlan(after).filter(x => x.will).length;
  if (will) {   // read only for this person, or nothing after the marker that can be put back: no button
    const r = el('button', 'btn btn-sm btn-danger tls-revert');
    r.type = 'button';
    r.append(el('span', 'tls-long', `Revert from here… (${will})`), el('span', 'tls-short', `Revert… (${will})`));
    r.title = 'Put back every change after the marker, newest first (it asks first)';
    r.onclick = () => revertFromHere(r);
    box.append(r);
  }
  return box;
}

function statusCls(o) {
  return [o.status === 'failed' && 'is-failed', o.status === 'reverted' && 'is-reverted', o.status === 'waiting' && 'is-waiting',
    o.status === 'done' && o.revert_class === 'B' && 'is-b', o.status === 'done' && o.revert_class === 'C' && 'is-c',
    o.revert_of && 'is-undo'].filter(Boolean).join(' ');
}
const statusWords = o => o.status === 'failed' ? 'failed' : o.status === 'reverted' ? 'put back' : o.status === 'waiting' ? 'waits for a manager'
  : o.revert_class === 'B' ? 'undone by its own action' : o.revert_class === 'C' ? 'final' : o.revert_of ? 'a put-back' : 'can be put back';
const glyphFor = o => glyphOf(o.command, o.family, o.revert_of ? ops.find(x => x.id === o.revert_of) : null);

function node(o, { count = 0, onOpen = null, label = null } = {}) {
  const g = glyphFor(o);
  const b = el('button', `tls-node ${statusCls(o)}`);
  b.type = 'button';
  b.dataset.op = o.id;
  b.innerHTML = glyphSvg(g.kind, g.verb) + (o.status === 'done' && o.revert_class === 'C' ? SVG.lock : '');
  if (count > 1) b.append(el('span', 'tls-count', `×${count}`));
  b.setAttribute('aria-label', label || `${titleOf(o)} — ${glyphLabel(g.kind, g.verb)}, ${o.by}, ${farmWhen(o.at)}, ${statusWords(o)}`);
  b.tabIndex = o.id === (selId || flat[flat.length - 1]?.id) ? 0 : -1;
  if (o.id === selId) b.classList.add('is-sel');
  b.onclick = () => { selId = o.id; markSel(); if (onOpen) onOpen(); else openPop(o, b); };
  b.onpointerenter = () => showTip(o, b, count);
  b.onpointerleave = hideTip;
  b.onfocus = () => showTip(o, b, count);
  b.onblur = hideTip;
  b.onkeydown = e => nodeKey(e, b);
  return b;
}
const li = (cls, kid) => { const x = el('div', 'tls-li ' + cls); x.setAttribute('role', 'listitem'); if (kid) x.append(kid); return x; };

function drawTrack(track) {
  const p = posOf();
  // every element of a line carries the positions it covers (data-at, data-n): the marker, its drag and is-after read them
  const li2 = (cls, at, n) => { const x = li(cls + (at >= p ? ' is-after' : '')); x.dataset.at = String(at); x.dataset.n = String(n); return x; };
  for (const it of items) {
    if (it.type === 'day') {
      const d = li('tls-day');
      d.append(el('span', null, shortDay(it.day)));
      d.setAttribute('aria-label', 'Day ' + shortDay(it.day));
      track.append(d);
      continue;
    }
    if (it.type === 'op') {
      const x = li2('tls-one' + (it.repeat ? ' in-repeat' : ''), it.at, 1);
      if (it.repeat && it.first) {
        const c = el('button', 'tls-unrepeat', `×${it.count}`);
        c.type = 'button'; c.title = 'Fold these repeats into one icon'; c.setAttribute('aria-label', `Fold the ${it.count} repeats`);
        c.onclick = () => { expanded.delete(it.repeat); refilter(); };
        x.prepend(c);
      }
      x.append(node(it.op));
      track.append(x);
      continue;
    }
    if (it.type === 'repeat') {
      const o = it.ops[it.ops.length - 1];
      const x = li2('tls-one tls-rep', it.at, it.ops.length);
      x.append(node(o, { count: it.ops.length, onOpen: () => { expanded.add(it.key); refilter(); },
        label: `${titleOf(o)} — ${it.ops.length} times in a row, ${o.by}, ${farmWhen(it.ops[0].at)} to ${farmWhen(o.at)}. Opens the repeats` }));
      track.append(x);
      continue;
    }
    // a group: an AI build (violet bracket), folds into one icon
    const ai = it.ops.some(s => s.actor === 'ai');
    const box = li2('tls-group' + (ai ? ' is-ai' : '') + (it.folded ? ' is-folded' : ''), it.at, it.ops.length);
    const g = groups[it.id] || { steps: it.ops.length };
    const n = g.steps || it.ops.length;
    const head = el('button', 'tls-ghead');
    head.type = 'button';
    head.innerHTML = it.folded ? SVG.group : '';
    head.append(el('span', null, `${ai ? 'AI' : 'Group'} ${n}`));
    head.setAttribute('aria-expanded', String(!it.folded));
    head.setAttribute('aria-label', `${ai ? 'AI build' : 'Group'}, ${n} steps, ${it.ops[0].by}, ${farmWhen(it.ops[0].at)}. ${it.folded ? 'Open' : 'Fold'} it`);
    head.title = `${ai ? 'AI build' : 'Group'} · ${n} steps${g.reverted ? ` · ${g.reverted} put back` : ''} · ${it.ops[0].by} · ${farmWhen(it.ops[0].at)}`;
    head.onclick = () => { if (folded.has(it.id)) folded.delete(it.id); else folded.add(it.id); refilter(); };
    box.append(head);
    if (!it.folded) {
      const steps = el('div', 'tls-steps');
      steps.setAttribute('role', 'list');
      it.ops.forEach((s, k) => { const x = li2('tls-one', it.at + k, 1); x.append(node(s)); steps.append(x); });
      box.append(steps);
    }
    track.append(box);
  }
  const m = markerEl(track);
  track.append(m);
  placeMarker(track, m);
  // one icon is always reachable with Tab (the newest, when the selection is inside a folded build)
  const nodes = track.querySelectorAll('.tls-node');
  if (nodes.length && !track.querySelector('.tls-node[tabindex="0"]')) nodes[nodes.length - 1].tabIndex = 0;
}
// the element the marker stands before at position p: the line that starts there (a group's box at its first step)
function anchorFor(track, p) {
  const all = [...track.querySelectorAll('.tls-li[data-at]')].filter(x => Number(x.dataset.at) === p);
  return all[0] || null;    // document order: a group's box comes before its first step
}
const shortDay = d => { const [y, mo, da] = String(d).split('-').map(Number); return new Date(y, mo - 1, da).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); };

// ── the marker (Fusion's rollback bar) ─────────────────────────────────────────────────────────────────────────────
function markerEl(track) {
  const m = el('div', 'tls-marker');
  m.tabIndex = 0;
  m.setAttribute('role', 'slider');
  m.setAttribute('aria-label', 'Marker: the changes after it are marked (nothing is rolled back)');
  m.setAttribute('aria-valuemin', '0'); m.setAttribute('aria-valuemax', String(flat.length));
  m.setAttribute('aria-valuenow', String(posOf()));
  m.setAttribute('aria-valuetext', posOf() >= flat.length ? 'at the end: nothing after it' : `${flat.length - posOf()} change${flat.length - posOf() === 1 ? '' : 's'} after it`);
  m.title = 'Drag, or ← →: everything after the marker is marked; Revert from here… puts it back';
  m.onkeydown = e => {
    const stops = markerStops(items), p = posOf();
    let to = null;
    if (e.key === 'ArrowLeft') to = [...stops].reverse().find(s => s < p) ?? 0;
    else if (e.key === 'ArrowRight') to = stops.find(s => s > p) ?? flat.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = flat.length;
    if (to === null) return;
    e.preventDefault();
    marker = to >= flat.length ? null : to; paint(); focusMarker();
  };
  m.onpointerdown = e => {
    e.preventDefault();
    m.setPointerCapture?.(e.pointerId);
    m.classList.add('is-drag');
    const moveTo = x => {
      const to = stopAt(track, x);
      if (to !== posOf()) { marker = to >= flat.length ? null : to; placeMarker(track, m); }
    };
    m.onpointermove = ev => moveTo(ev.clientX);
    m.onpointerup = m.onpointercancel = () => { m.onpointermove = null; m.classList.remove('is-drag'); paint(); focusMarker(); };
  };
  return m;
}
// the stop nearest to x: the left edge of the line that starts there, or the right edge of the one that ends there
function stopAt(track, x) {
  const edge = new Map();
  for (const li of track.querySelectorAll('.tls-li[data-at]')) {
    const at = Number(li.dataset.at), n = Number(li.dataset.n), r = li.getBoundingClientRect();
    if (!edge.has(at)) edge.set(at, r.left);
    edge.set(at + n, Math.max(edge.get(at + n) ?? -Infinity, r.right));
  }
  let best = posOf(), d = Infinity;
  for (const s of markerStops(items)) { const ex = edge.get(s); if (ex !== undefined && Math.abs(ex - x) < d) { d = Math.abs(ex - x); best = s; } }
  return best;
}
function placeMarker(track, m) {
  const p = posOf();
  track.querySelectorAll('.tls-li[data-at]').forEach(x => x.classList.toggle('is-after', Number(x.dataset.at) >= p));
  const target = p >= flat.length ? null : anchorFor(track, p);
  if (target) target.before(m); else track.append(m);
  m.setAttribute('aria-valuenow', String(p));
  const left = flat.length - p;
  m.setAttribute('aria-valuetext', left ? `${left} change${left === 1 ? '' : 's'} after it` : 'at the end: nothing after it');
  root.querySelector('.tls-opts')?.replaceWith(options());
}
const focusMarker = () => root?.querySelector('.tls-marker')?.focus({ preventScroll: false });
function scrollToEnd() { const t = root?.querySelector('.tls-track'); if (t) t.scrollLeft = t.scrollWidth; }

// ── the selection, the keys ────────────────────────────────────────────────────────────────────────────────────────
function markSel() {
  root.querySelectorAll('.tls-node').forEach(n => { const on = n.dataset.op === selId; n.classList.toggle('is-sel', on); n.tabIndex = on ? 0 : -1; });
}
function nodeKey(e, b) {
  const all = [...root.querySelectorAll('.tls-node')];
  const i = all.indexOf(b);
  let j = null;
  if (e.key === 'ArrowRight') j = Math.min(all.length - 1, i + 1);
  else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = all.length - 1;
  if (j === null) return;
  e.preventDefault();
  selId = all[j].dataset.op; markSel(); all[j].focus();
  all[j].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
}

// ── hover: what, who, the actor, when ─────────────────────────────────────────────────────────────────────────────
function showTip(o, anchor, count = 0) {
  hideTip();
  if (pop) return;
  tip = el('div', 'tls-tip');
  tip.setAttribute('role', 'tooltip');
  const g = glyphFor(o);
  tip.append(el('b', null, titleOf(o) + (count > 1 ? ` ×${count}` : '')),
    el('div', null, `${o.by} · ${ACTORS_LOGGED[o.actor] || o.actor} · ${farmWhen(o.at)}`),
    el('div', 'hint', [glyphLabel(g.kind, g.verb), FAMILY[o.family] || o.family, statusWords(o)].filter(Boolean).join(' · ')));
  if (o.status === 'failed' && o.error) tip.append(el('div', 'tls-tip-bad', o.error));
  document.body.append(tip);
  place(tip, anchor);
}
function hideTip() { tip?.remove(); tip = null; }
function place(box, anchor) {
  const r = anchor.getBoundingClientRect(), w = box.offsetWidth, vw = document.documentElement.clientWidth;
  box.style.left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  box.style.top = (r.bottom + 6) + 'px';
}

// ── a click: the same detail and actions as the Timeline ──────────────────────────────────────────────────────────
function openPop(o, anchor) {
  closePop(); hideTip();
  pop = el('div', 'tls-pop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', titleOf(o));
  const g = glyphFor(o);
  const head = el('div', 'tls-pop-head');
  const ic = el('span', `tls-node is-static ${statusCls(o)}`);
  ic.innerHTML = glyphSvg(g.kind, g.verb);
  const x = el('button', 'btn btn-ghost btn-sm', '✕');
  x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { closePop(); anchor.focus(); };
  head.append(ic, el('b', 'tls-pop-title', titleOf(o)), x);
  pop.append(head, el('div', 'hint', `${o.by} · ${ACTORS_LOGGED[o.actor] || o.actor} · ${farmWhen(o.at)}${o.family ? ' · ' + (FAMILY[o.family] || o.family) : ''}`));
  const notes = notesOf(o);
  if (notes.length) pop.append(el('div', 'hint', notes.join(' · ')));
  if (o.status === 'failed') pop.append(el('div', 'op-error', 'Failed: ' + (o.error || 'refused') + ' — nothing was changed.'));
  if (o.status === 'reverted') pop.append(el('div', 'hint', `Put back ${farmWhen(o.reverted_at)}`));
  if (o.status === 'waiting') pop.append(el('div', 'hint', 'Waits for a manager: nothing was applied, nothing to put back.'));
  const acts = el('div', 'tls-pop-acts');
  actionsOf(o, { farm: farmFor(o.farm_id), after: () => { closePop(); read(); } }).forEach(n => acts.append(n));
  const tl = el('a', 'btn btn-sm btn-ghost', 'Open in Timeline');
  tl.href = '#/dashboard/timeline';
  tl.onclick = () => closePop();
  acts.append(tl);
  pop.append(acts);
  pop.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); anchor.focus(); } };
  document.body.append(pop);
  place(pop, anchor);
  setTimeout(() => (pop?.querySelector('.tls-pop-acts button, .tls-pop-acts a') || x).focus(), 20);
}
function closePop() { pop?.remove(); pop = null; }

// ── Revert from here… ─────────────────────────────────────────────────────────────────────────────────────────────
async function revertFromHere(btn) {
  const plan = revertPlan(afterMarker(items, posOf()));
  const will = plan.filter(p => p.will);
  if (!will.length) return;
  btn.disabled = true;
  // what each one would meet (operation_detail): a conflict made by a later line of the plan clears itself, others block
  const details = new Map();
  try {
    for (let i = 0; i < will.length; i += 8) {
      const part = will.slice(i, i + 8);
      const ans = await Promise.all(part.map(p => rpc('operation_detail', { p_op: p.op.id }, { quiet: true }).catch(e => ({ error: say(e) }))));
      part.forEach((p, k) => details.set(p.op.id, ans[k]));
    }
  } finally { btn.disabled = false; }
  hideTip(); closePop();
  const dr = drawer('Revert from here', `${plan.length} change${plan.length === 1 ? '' : 's'} after the marker: ${will.length} to put back, newest first`);
  dr.body.append(el('p', null, 'The marker rolled nothing back. This puts back, newest first, every change after it that you may put back. ' +
    'It stops at the first one that is refused and says what was and was not put back. A put-back is itself a line of the log.'));
  const ul = el('ul', 'tls-plan');
  for (const p of plan) {
    const o = p.op, g = glyphFor(o), d = details.get(o.id);
    const row = el('li', p.will ? 'will' : 'stays');
    const ic = el('span', `tls-node is-static ${statusCls(o)}`); ic.innerHTML = glyphSvg(g.kind, g.verb);
    const text = el('div', 'tls-plan-text');
    text.append(el('b', null, titleOf(o)), el('span', 'hint', ` ${o.by} · ${farmWhen(o.at)}`));
    if (!p.will) text.append(el('div', 'hint', 'Stays: ' + p.why));
    else {
      const c = conflictsOf(d?.conflicts, plan);
      if (d?.error) text.append(el('div', 'op-error', d.error));
      c.blocks.forEach(x => text.append(el('div', 'op-error', 'Changed since, outside this range: ' + conflictText(x) + ' — it will stop here')));
      c.clears.forEach(x => text.append(el('div', 'hint', 'Changed again later in this range (put back first): ' + conflictText(x))));
    }
    row.append(ic, text, el('span', 'tls-plan-tag ' + (p.will ? 'will' : 'stays'), p.will ? 'put back' : 'stays'));
    ul.append(row);
  }
  dr.body.append(ul);
  const no = el('button', 'btn', 'Cancel');
  no.onclick = () => dr.close();
  const yes = el('button', 'btn btn-danger', `Put back ${will.length}…`);
  yes.onclick = async () => {
    dr.close();
    if (!(await confirmDrawer(`Put ${will.length} change${will.length === 1 ? '' : 's'} back?`,
      `Newest first, from ${farmWhen(will[0].op.at)} back to ${farmWhen(will[will.length - 1].op.at)}. It stops at the first refusal; what was put back before it stays put back.`,
      'Put them back', true))) return;
    await runRevert(plan);
  };
  dr.footer.append(no, yes);
}

async function runRevert(plan) {
  const units = revertUnits(plan, id => groups[id]?.left ?? null);
  const done = [], all = plan.filter(p => p.will).map(p => p.op);
  let stop = null;
  for (const u of units) {
    try {
      if (u.type === 'group') {
        const r = await rpc('revert_group', { p_group: u.id, p_page: here() });
        const n = r?.reverted || 0;
        done.push(...u.ops.slice(0, n));
        if (r?.stopped_at) { stop = { what: r.stopped_at.summary || 'a step of the build', why: r.stopped_at.why || 'refused' }; break; }
      } else {
        const o = u.op;
        if (o.source === 'farmnet') {   // FarmNet keeps no conflict check of its own: ask the log right before
          const d = await rpc('operation_detail', { p_op: o.id }, { quiet: true });
          if (d.conflicts?.length) { stop = { what: titleOf(o), why: d.conflicts.map(conflictText).join('; ') }; break; }
        }
        await revertOne(o, farmFor(o.farm_id));
        done.push(o);
      }
    } catch (e) { stop = { what: u.type === 'group' ? 'an AI build' : titleOf(u.op), why: say(e) }; break; }
  }
  const left = all.filter(o => !done.includes(o));
  const dr = drawer(stop ? 'Stopped' : 'Put back', `${done.length} of ${all.length} put back`);
  if (stop) dr.body.append(el('p', null, `It stopped at “${stop.what}”: ${stop.why}.`));
  if (done.length) { dr.body.append(el('h4', null, 'Put back')); const u = el('ul', 'tls-plan-plain'); done.forEach(o => u.append(el('li', null, `${titleOf(o)} · ${farmWhen(o.at)}`))); dr.body.append(u); }
  if (left.length) { dr.body.append(el('h4', null, 'Not put back')); const u = el('ul', 'tls-plan-plain'); left.forEach(o => u.append(el('li', null, `${titleOf(o)} · ${farmWhen(o.at)}`))); dr.body.append(u); }
  const stays = plan.filter(p => !p.will).length;
  if (stays) dr.body.append(el('p', 'hint', `${stays} change${stays === 1 ? '' : 's'} after the marker stay${stays === 1 ? 's' : ''} as they are (final, read only, or nothing to put back).`));
  if (!stop) toast(`Put back: ${done.length}`, 'ok');
  marker = null;
  notifyOperations();   // the Timeline tab, when it is on screen, reads again too
  await read();
}

// ── ▶ the replay: opens each line's page and highlights its button, never clicks ─────────────────────────────────
async function startPlay() {
  if (!flat.length) return;
  closePop();
  const list = flat.slice(), from = posOf() < flat.length ? posOf() : 0;
  const me = play = { stop: false, hash: route() };
  paint();
  for (let i = from; i < list.length && !me.stop; i++) {
    const o = list[i], t0 = Date.now();
    const page = ROUTE.test(o.page || '') ? o.page : pagesOf(o.command)[0];
    try {
      if (page && page !== route()) { me.hash = page; await navigate(page); }
      if (me.stop) break;
      selId = o.id; markSel();
      const n = root.querySelector(`.tls-node[data-op="${o.id}"]`) || liAt(i)?.querySelector('.tls-node, .tls-ghead');
      if (n) {
        root.querySelectorAll('.is-sel').forEach(x => x.classList.remove('is-sel'));
        n.classList.add('is-sel');     // a collapsed repeat or a folded build: its one icon
        n.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' }); showTip(o, n); }
      const a = getCommand(o.command) ? await locate(o.command, o.args, 1000) : null;
      if (me.stop) break;
      if (a) await highlight(a);
    } catch { /* a page that would not open: the next line */ }
    const rest = STEP_MS - (Date.now() - t0);
    if (rest > 0 && !me.stop) await new Promise(r => setTimeout(r, rest));
  }
  if (play === me) { play = null; hideTip(); refilter(); }
}
// the innermost line that covers position i (a collapsed repeat, a folded build)
function liAt(i) {
  const all = [...root.querySelectorAll('.tls-li[data-at]')].filter(x => Number(x.dataset.at) <= i && i < Number(x.dataset.at) + Number(x.dataset.n));
  return all[all.length - 1] || null;
}
function stopPlay() { if (play) { play.stop = true; play = null; hideTip(); if (root) refilter(); } }
