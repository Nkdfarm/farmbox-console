// ═══════════════════════════════════════════════════════════════════════════
// Slide player — plays a Claude Slides deck full screen, with its click steps (Roadmap › Presentations, 0294)
//
// A deck comes from the database (presentation_deck(id)): 1920×1080 <section> HTML per slide, its notes, the deck's
// CSS and fonts. Nothing of a deck is in these files: the console is served from a public repository.
// Two kinds of click step, both replayed here:
//   fragments  class="fragment" (+ data-fragment-index; the same index is one click), shown by adding .visible, so
//              the deck's own CSS animates it (.fl from the left, .fr from the right 250 ms later, .fd a fade…)
//   builds     data-build-in="fade|rise|drop|left|right|scale|pop [order] [auto]" on pinned children (the same order
//              is one click; auto steps follow by themselves), data-build-out the same way to leave.
// Each slide is drawn in a shadow root, so the deck's CSS reaches nothing of the console; a slide is put in again
// each time it is shown, so its own arrival animations play again. Slides change with a fade.
// The HTML was cleaned on import (scripts/import-deck.py) and is cleaned again here (cleanSlide): an allow-list of
// tags and attributes, pictures only from the deck's own /_blob/ files, which become short-lived signed addresses.
// Keys: → ↓ space Enter PageDown or a click forward; ← ↑ Backspace PageUp back; Home/End; N notes; F full screen; Esc.
// reveal.js was looked at first: it owns its page (.reveal .slides) and knows nothing of data-build-in.
// ═══════════════════════════════════════════════════════════════════════════
import { el, icon } from './ui.js';

const TAGS = new Set(['section', 'div', 'p', 'h1', 'h2', 'h3', 'span', 'b', 'i', 'u', 'br', 'img', 'x-icon', 'x-shape',
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop']);
const ATTRS = new Set(['class', 'id', 'style', 'alt', 'aria-label', 'aria-hidden', 'role', 'width', 'height', 'name', 'kind',
  'data-fragment-index', 'data-build-in', 'data-build-out', 'data-transition', 'viewbox', 'xmlns', 'd', 'fill', 'stroke',
  'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'fill-rule',
  'clip-rule', 'opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'offset',
  'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'preserveaspectratio']);
// a value that could load something or run something; a backslash too (a CSS escape can spell url( or image-set( unseen)
const BAD = /javascript:|vbscript:|data:|expression\s*\(|url\s*\(\s*['"]?\s*[^#'"\s]|image-set|image\s*\(|src\s*\(|element\s*\(|cross-fade|@import|behavior\s*:|-moz-binding|[<\\]/i;
const TEXT = new Set(['alt', 'aria-label']);   // words only, read aloud, never loaded
const BLOB = /^\/_blob\/([0-9a-f]{32}\.(?:png|jpe?g|webp|gif))$/;

// the slide's HTML, cleaned, as a <section> that is not in any page yet (a template's content loads nothing)
export function cleanSlide(html, urlFor) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const sec = t.content.querySelector('section');
  if (!sec) return null;
  for (const n of [...sec.querySelectorAll('*')]) {
    const tag = n.localName.toLowerCase();
    if (!n.isConnected && !sec.contains(n)) continue;   // inside something already removed
    if (!TAGS.has(tag)) { tag === 'aside' || !/^(b|i|u|span|a|strong|em)$/.test(tag) ? n.remove() : n.replaceWith(...n.childNodes); continue; }
    for (const a of [...n.attributes]) {
      const k = a.name.toLowerCase(), v = a.value;
      if (tag === 'img' && k === 'src') { const m = v.match(BLOB), u = m && urlFor(m[1]); if (u) n.setAttribute('src', u); else n.removeAttribute('src'); continue; }
      if (!ATTRS.has(k) || (!TEXT.has(k) && BAD.test(v)) || (k === 'xmlns' && v !== 'http://www.w3.org/2000/svg')) n.removeAttribute(a.name);
    }
  }
  for (const a of [...sec.attributes]) if (!['id', 'class', 'style', 'data-transition'].includes(a.name) || BAD.test(a.value)) sec.removeAttribute(a.name);
  for (const i of sec.querySelectorAll('x-icon')) i.replaceChildren(iconSvg(i.getAttribute('name')));
  return sec;
}

// the deck's CSS for its shadow root: nothing that loads from elsewhere (a declaration with a backslash, image-set()
// and the like goes whole), and :root / html become the shadow host, body the slide box
export function cleanCss(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/[^;{}]*(?:\\|image-set|image\s*\(|src\s*\(|element\s*\(|cross-fade)[^;{}]*;?/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*(?!#)[^)]*\)/gi, 'none').replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding|</gi, '')
    .replace(/([^{}]*)\{/g, (m, sel) => (sel.trim().startsWith('@') ? sel
      : sel.replace(/(^|[\s,>+~])(?::root|html)(?![\w-])/g, '$1:host').replace(/(^|[\s,>+~])body(?![\w-])/g, '$1.pz-body')) + '{');
}

// Slides' icon names, drawn on the console's 24 grid; names the console already has use its drawing
const OWN = { Chart: 'chart', CheckCircle: 'check', Clock: 'clock', Cloud: 'cloud', Database: 'database', Globe: 'globe',
  Settings: 'settings', Tool: 'wrench', Users: 'users', Warning: 'alert', Wrench: 'wrench' };
const PATHS = {
  Activity: 'M22 12h-4l-3 9L9 3l-3 9H2', Book: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5a2.5 2.5 0 0 0 0 5H20',
  Chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z', Check: 'm5 12.5 4.5 4.5L19 7.5',
  Code: 'm8 7-5 5 5 5M16 7l5 5-5 5', GraduationCap: 'M2 9.5 12 5l10 4.5-10 4.5Zm4 2v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9.5V15',
  Home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z', Key: 'M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2 4.5 4.5 0 0 1 1.3 3.2ZM13.2 12.7 21 20.5M17.5 17l2-2M19.5 19l1.5-1.5',
  Lightbulb: 'M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.4 1 2.2V17h6v-.7c0-.8.3-1.6 1-2.2a6.5 6.5 0 0 0-4-11.6Z',
  Lightning: 'M13 2 4 14h7l-1 8 9-12h-7Z', Link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  Lock: 'M6 11h12v10H6ZM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11', PaperPlane: 'M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8-8-4Z', Play: 'M7 4v16l13-8Z',
  Search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-5.5-5.5',
  Star: 'm12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z',
  ThumbsUp: 'M7 10v11M7 10l4-8a2.5 2.5 0 0 1 2.5 3L13 10h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H3V10Z',
  Trust: 'M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6ZM8.5 12l2.5 2.5 4.5-5',
  Verified: 'M12 2.5l2.4 1.8 3-.2.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.2-2.4 1.8-2.4-1.8-3 .2-.9-2.9L3.3 15.6l1-2.8-1-2.8 2.4-1.8.9-2.9 3 .2ZM8.5 12l2.5 2.5 4.5-5',
};
function iconSvg(name) {
  if (OWN[name]) return icon(OWN[name]);
  const s = icon('');
  if (PATHS[name]) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[name]); s.append(p); }
  return s;
}

// the page around the slides (viewer rules of Claude Slides) and the two kinds of step
const BASE = `:host { all: initial; display: block; }
.pz-body { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; font: 32px/1.2 sans-serif; color: #111; background: #fff; }
:where(.pz-body *) { margin: 0; }
.pz-body > section { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; box-sizing: border-box; isolation: isolate; opacity: 0; transition: opacity 500ms ease; }
.pz-body > section.pz-now { opacity: 1; }
.pz-body > section.pz-still { transition: none; }
section[hidden], aside, noscript { display: none !important; }
h1 { font-size: 96px; font-weight: 600; } h2 { font-size: 64px; font-weight: 600; } h3 { font-size: 44px; font-weight: 600; }
p, li, h1, h2, h3 { overflow-wrap: break-word; text-wrap: pretty; }
x-shape, x-icon { display: block; } x-icon > svg { display: block; width: 100%; height: 100%; }
x-shape[kind=ellipse] { border-radius: 50%; }
x-shape[kind=diamond] { clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
x-shape[kind=arrow-right] { clip-path: polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%); }
x-shape[kind=arrow-left] { clip-path: polygon(100% 30%, 40% 30%, 40% 0, 0 50%, 40% 100%, 40% 70%, 100% 70%); }
x-shape[kind=arrow-down] { clip-path: polygon(30% 0, 70% 0, 70% 60%, 100% 60%, 50% 100%, 0 60%, 30% 60%); }
x-shape[kind=arrow-up] { clip-path: polygon(30% 100%, 70% 100%, 70% 40%, 100% 40%, 50% 0, 0 40%, 30% 40%); }
.fragment { opacity: 0; transition: opacity 400ms ease-out; } .fragment.visible { opacity: 1; }
[data-pz] { opacity: 0; transition: opacity 500ms ease-out, translate 650ms cubic-bezier(.2,.7,.2,1), scale 550ms cubic-bezier(.2,.7,.2,1); }
[data-pz=rise] { translate: 0 60px; } [data-pz=drop] { translate: 0 -60px; } [data-pz=left] { translate: -120px 0; } [data-pz=right] { translate: 120px 0; }
[data-pz=scale] { scale: .85; } [data-pz=pop] { scale: .5; transition-timing-function: ease-out, ease-out, cubic-bezier(.34,1.56,.64,1); }
[data-pz].pz-on { opacity: 1; translate: none; scale: none; } .pz-body .pz-gone { opacity: 0 !important; transition: opacity 400ms ease-out; }
.pz-shot [data-pz], .pz-shot .fragment { transition: none !important; }`;

// one slide drawn into a box of its own (a shadow root), scaled to `width`; used for the list's thumbnails
export function slideBox(deck, sec, width) {
  const host = el('div', 'pz-host');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BASE + '\n' + cleanCss(deck.css);
  const body = el('div', 'pz-body');
  root.append(style, body);
  if (width) { host.style.transform = `scale(${width / 1920})`; }
  if (sec) { body.classList.add('pz-shot'); sec.classList.add('pz-now', 'pz-still'); body.append(sec); const s = stepsOf(sec, deck.kind); showSteps(s, s.length);
    requestAnimationFrame(() => { if (host.isConnected) fixUp(sec); }); }   // computed styles need the box in the page
  return { host, body };
}
export function loadFaces(faces) {
  for (const f of faces || []) {
    const href = String(f?.href || '');
    if (!href.startsWith('https://fonts.googleapis.com/css2?') || [...document.head.querySelectorAll('link')].some(l => l.href === href)) continue;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l);
  }
}

// a slide's click steps, in order: [{show: [el], hide: [el], auto}]
function stepsOf(sec, kind) {
  const groups = new Map(), late = [];
  const put = (key, part, n, auto) => { if (key == null) { late.push({ show: [], hide: [], auto, [part]: [n] }); return; }
    if (!groups.has(key)) groups.set(key, { show: [], hide: [], auto: true }); const g = groups.get(key); g[part].push(n); g.auto = g.auto && auto; };
  if (kind === 'fragments') {
    for (const n of sec.querySelectorAll('.fragment')) { const i = parseInt(n.dataset.fragmentIndex, 10); put(Number.isFinite(i) ? i : null, 'show', n, false); }
  } else {
    for (const [attr, part] of [['buildIn', 'show'], ['buildOut', 'hide']]) {
      for (const n of sec.querySelectorAll(`[data-build-${part === 'show' ? 'in' : 'out'}]`)) {
        const w = n.dataset[attr].trim().split(/\s+/), order = w.map(Number).find(Number.isFinite);
        if (part === 'show') n.dataset.pz = /^(fade|rise|drop|left|right|scale|pop)$/.test(w[0]) ? w[0] : 'fade';
        put(order ?? null, part, n, w.includes('auto'));
      }
    }
  }
  return [...[...groups].sort((a, b) => a[0] - b[0]).map(g => g[1]), ...late];
}
function showSteps(steps, k) {
  steps.forEach((s, j) => {
    for (const n of s.show) n.classList.toggle(n.classList.contains('fragment') ? 'visible' : 'pz-on', j < k);
    for (const n of s.hide) n.classList.toggle('pz-gone', j < k);
  });
}
// two viewer rules of Claude Slides that a browser does not do by itself
function fixUp(sec) {
  for (const c of sec.children) { if (getComputedStyle(c).position !== 'absolute') break; c.style.zIndex = '-1'; }
  for (const c of sec.querySelectorAll('*')) {
    const p = c.parentElement, ps = p && getComputedStyle(p);
    if (ps?.display.includes('flex') && ps.flexDirection.startsWith('column') && parseFloat(getComputedStyle(c).flexGrow) > 0) c.style.minHeight = '0';
  }
}

// ── the player ──
export function playDeck(deck, urlFor, back = document.activeElement) {
  const slides = (deck.slides || []).map(s => ({ ...s, sec: cleanSlide(s.html, urlFor) })).filter(s => s.sec);
  if (!slides.length) return;
  loadFaces(deck.faces);
  const player = el('div', 'pz-player');
  player.setAttribute('role', 'dialog'); player.setAttribute('aria-label', deck.title || 'Presentation'); player.setAttribute('aria-modal', 'true'); player.tabIndex = -1;
  const view = el('div', 'pz-view');
  const { host, body } = slideBox(deck, null, 0);
  view.append(host);
  const notes = el('aside', 'pz-notes'); notes.hidden = true;
  const count = el('span', 'pz-count'); count.setAttribute('aria-live', 'polite');
  const btn = (name, label, fn) => { const b = el('button', 'pz-btn'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.append(icon(name)); b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
  const bar = el('div', 'pz-bar');
  bar.append(btn('chevronLeft', 'Back (←)', prev), count, btn('chevronRight', 'Forward (→, space)', next),
             el('span', 'spacer'), btn('clipboard', 'Speaker notes (N)', toggleNotes), btn('monitor', 'Full screen (F)', toggleFs), btn('logout', 'Close (Esc)', close));
  player.append(view, notes, bar);
  document.body.append(player);
  let cur = -1, step = 0, steps = [], live = null, timer = 0, fsByButton = false;

  function fit() {
    const r = view.getBoundingClientRect(), s = Math.min(r.width / 1920, r.height / 1080);
    host.style.transform = `translate(${(r.width - 1920 * s) / 2}px, ${(r.height - 1080 * s) / 2}px) scale(${s})`;
  }
  function go(i, atEnd) {
    clearTimeout(timer);
    const old = live;
    cur = i; live = slides[i].sec.cloneNode(true);   // put in again: its own arrival animations play again
    body.classList.add('pz-shot');                    // the steps take their place without playing; the slide fades in
    body.append(live); fixUp(live);
    steps = stepsOf(live, deck.kind); step = atEnd ? steps.length : 0;
    showSteps(steps, step); void live.offsetWidth; body.classList.remove('pz-shot');
    requestAnimationFrame(() => live.classList.add('pz-now'));
    if (old) { old.classList.remove('pz-now'); setTimeout(() => old.remove(), 550); }
    paint(); autoNext(true);
  }
  function autoNext(arrived) {
    clearTimeout(timer);
    if (steps[step]?.auto) timer = setTimeout(() => { step++; showSteps(steps, step); paint(); autoNext(false); }, arrived ? 600 : 520);
  }
  function next() { if (step < steps.length) { step++; showSteps(steps, step); paint(); autoNext(false); } else if (cur < slides.length - 1) go(cur + 1, false); }
  function prev() { clearTimeout(timer); if (step > 0) { step--; showSteps(steps, step); paint(); } else if (cur > 0) go(cur - 1, true); }
  function paint() {
    count.textContent = `${cur + 1} / ${slides.length}` + (steps.length ? ` · ${step}/${steps.length}` : '');
    const paras = String(slides[cur].notes || '').split(/\n\s*\n/).filter(p => p.trim());
    notes.replaceChildren(el('div', 'pz-notes-head', `Notes · slide ${cur + 1}`), ...(paras.length ? paras : ['No notes for this slide.']).map(p => el('p', null, p.trim())));
    // "[Click N]" paragraphs follow the steps; "[On screen]" is the slide before its first click
    const mark = [...notes.querySelectorAll('p')].find(p => step ? p.textContent.startsWith(`[Click ${step}]`) : p.textContent.startsWith('[On screen]'));
    if (mark) { mark.classList.add('now'); if (!notes.hidden) mark.scrollIntoView({ block: 'nearest' }); }
  }
  function toggleNotes() { notes.hidden = !notes.hidden; player.classList.toggle('with-notes', !notes.hidden); fit(); paint(); }
  function toggleFs() {
    if (document.fullscreenElement) { fsByButton = true; document.exitFullscreen?.().catch(() => { fsByButton = false; }); }
    else player.requestFullscreen?.().catch(() => {});   // refused (an iframe, an old browser): the full window stays
  }
  function onFs() { if (!document.fullscreenElement && !fsByButton) close(); fsByButton = false; setTimeout(fit, 50); }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Tab') {   // the focus stays in the player: its own buttons, round and round
      const b = [...bar.querySelectorAll('button')], i = b.indexOf(document.activeElement);
      b[(i + (e.shiftKey ? -1 : 1) + b.length + (i < 0 && e.shiftKey ? 1 : 0)) % b.length].focus(); e.preventDefault(); return;
    }
    if ((k === ' ' || k === 'Enter') && bar.contains(e.target)) return;   // a focused button does its own job
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) prev();
    else if (k === 'Home') go(0, false); else if (k === 'End') go(slides.length - 1, true);
    else if (k === 'Escape') close(); else if (k === 'n' || k === 'N') toggleNotes(); else if (k === 'f' || k === 'F') toggleFs();
    else return;
    e.preventDefault(); e.stopPropagation();
  }
  function close() {
    clearTimeout(timer);
    removeEventListener('resize', fit); document.removeEventListener('keydown', onKey, true); document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement === player) { fsByButton = true; document.exitFullscreen?.().catch(() => {}); }
    player.remove(); back?.focus?.();
  }
  view.addEventListener('click', next);
  addEventListener('resize', fit);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFs);
  player.requestFullscreen?.().catch(() => {});
  player.focus(); fit(); go(0, false);
  return { next, prev, go, close, state: () => ({ slide: cur, step, steps: steps.length }) };
}
