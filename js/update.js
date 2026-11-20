// ═══════════════════════════════════════════════════════════════════════════
// "A new version is ready" — the same idea as the phone app's update card
//
// An installed PWA can sit on an old copy of itself for a long time: the tab
// is never closed, the service worker only swaps on a navigation, and nobody
// thinks to reload a thing that looks like an application. So the console
// asks version.json every few minutes and says so out loud when the number
// has moved.
//
// "Update now" does not just reload. It unregisters the worker and empties
// the caches first, then navigates to a URL nobody has seen before, because a
// plain reload can be answered from the browser's own HTTP cache (GitHub
// Pages sends max-age=600) and the card would come straight back.
// ═══════════════════════════════════════════════════════════════════════════
import { el } from './ui.js';

export const VERSION = '0.12.01';

const DISMISSED = 'fbc_update_dismissed';
const TARGET    = 'fbc_update_target';
const TARGET_AT = 'fbc_update_target_at';   // when Update now was pressed for it
const LAST      = 'fbc_last_version';
// Every minute: version.json is a few bytes, and at five minutes a person who
// had just been told "it is published" sat looking at a console that said nothing.
const EVERY_MS  = 60 * 1000;

const get = (store, k) => { try { return store.getItem(k); } catch { return null; } };
const set = (store, k, v) => { try { store.setItem(k, v); } catch { /* private window */ } };

let updating = false;      // Update now was pressed: the top bar shows progress
let justUpdated = false;   // this page load is the end of an update
let seen = null;           // the version version.json said last time: offered only when said twice
let notYet = 0;            // when the server last had the new number but not the new files

export function watchForUpdates() {
  afterUpdate();
  check();
  setInterval(check, EVERY_MS);
  // Coming back to a tab left open for a day is exactly when this matters.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  addEventListener('focus', check);
}

let lastCheck = 0;
async function check() {
  if (updating) return;
  // focus and visibilitychange fire together: two checks milliseconds apart met the "said twice" guard at once
  if (Date.now() - lastCheck < 20_000) return;
  lastCheck = Date.now();
  const latest = (await checkForUpdate())?.version;
  if (updating) return;
  // The server behind version.json is a CDN: right after a deploy it can say
  // the new number while index.html and the modules are still the old ones,
  // and even flip between the two for a while. So a new number is offered only
  // once it has been said twice in a row, and not within five minutes of an
  // attempt that found the files not there yet.
  const steady = latest && latest !== VERSION && seen === latest;
  seen = latest;
  if (Date.now() - notYet < 5 * 60 * 1000) return;
  if (!steady) return;
  if (get(sessionStorage, DISMISSED) === latest) return;

  // "Update now" was pressed for this version and here we are, still on the old one: the CDN served the old files
  // again (the loop of 18 Sept and again 19 Nov 2026, when 0.9.7 and 0.9.8 went out minutes apart). Do not offer the
  // button straight away, for the person to press again and land here again: say so, hold five minutes since the
  // press, then offer it once more as new.
  if (get(sessionStorage, TARGET) === latest) {
    const since = Date.now() - (Number(get(sessionStorage, TARGET_AT)) || 0);
    if (since < 5 * 60 * 1000) { show(latest, true); return; }
    try { sessionStorage.removeItem(TARGET); sessionStorage.removeItem(TARGET_AT); } catch { /* ignore */ }
  }
  show(latest, false);
}

function show(latest, stuck) {
  const old = document.getElementById('updateCard');
  if (old && old.dataset.v === latest && old.dataset.stuck === String(stuck)) return;   // already there: not rebuilt (it flickered every minute)
  old?.remove();

  const card = el('div', 'update-card');
  card.id = 'updateCard';
  card.dataset.v = latest;
  card.dataset.stuck = String(stuck);
  card.setAttribute('role', 'status');

  const text = el('div', 'update-text');
  text.append(el('b', null, `Version ${latest} is ready`));
  text.append(el('span', null, stuck
    ? 'This connection still serves the old files. It will be offered again in a few minutes.'
    : `You are on ${VERSION}. Nothing you have typed is lost by updating.`));

  const no = el('button', 'btn btn-ghost btn-sm', '✕');
  no.setAttribute('aria-label', 'Not now');
  no.onclick = () => { set(sessionStorage, DISMISSED, latest); card.remove(); };

  card.append(el('span', 'update-mark', '✦'), text);
  if (!stuck) {
    const go = el('button', 'btn btn-primary btn-sm', 'Update now');
    go.onclick = () => update(latest);
    card.append(go);
  }
  card.append(no);
  document.body.append(card);
}

// ── the top bar: the progress of an update, nothing to press ───────────────
// Between Connected and the gear. The card above is the one place the update is offered (owner, 19 Nov 2026: "the
// pop up only on bottom"); this is where it shows it is actually happening.
const slot = () => document.getElementById('upd');
let hideTimer;

function progress(pct, label, busy = false) {
  const s = slot();
  if (!s) return;
  clearTimeout(hideTimer);
  let bar = s.querySelector('.upd-bar');
  if (!bar) {
    s.textContent = '';
    bar = el('div', 'upd-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.append(el('i'));
    s.append(bar, el('small'));
  }
  bar.classList.toggle('busy', busy);
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  bar.setAttribute('aria-label', label);
  bar.firstChild.style.width = pct + '%';
  s.querySelector('small').textContent = label;
  s.title = label;
  s.hidden = false;
}

// Each step stays on screen long enough to be read; the real work is quicker
// than that, and a bar that jumps from nothing to a reload says nothing.
const step = (pct, label) => {
  progress(pct, label);
  return new Promise(r => setTimeout(r, 300));
};

// The new version reports the last part: app.js saves every page for offline
// after loading, and that is most of the wait.
export function updateProgress(done, total) {
  if (justUpdated) progress(85 + 15 * done / total, `Saving pages for offline ${done}/${total}`);
}

export function finishUpdate() {
  if (!justUpdated) return;
  justUpdated = false;
  progress(100, `Updated to ${VERSION}`);
  hideTimer = setTimeout(() => { const s = slot(); s.hidden = true; s.textContent = ''; }, 4000);
}

async function update(latest) {
  updating = true;
  document.getElementById('updateCard')?.remove();
  await step(10, 'Preparing the update');
  // the new files first: when they have not reached this connection yet, the old worker and its shell cache
  // stay, so the console still opens offline (they used to be removed before the check)
  await step(30, `Downloading ${latest}`);
  await refreshShell();
  if (!(await arrived(latest))) {
    updating = false;
    notYet = Date.now();
    progress(100, `${latest} is published but has not reached this connection yet — it will be offered again in a few minutes`);
    hideTimer = setTimeout(() => { const s = slot(); if (s) { s.hidden = true; s.textContent = ''; } }, 8000);
    return;
  }
  try {
    await step(55, 'Stopping the old version');
    const regs = await navigator.serviceWorker?.getRegistrations() ?? [];
    await Promise.all(regs.map(r => r.unregister()));
    await step(75, 'Clearing the old copy');
    // the shell only: fbc-data* is the farm's data kept for reading offline (and fbc-data-models the FarmNet 3D
    // models, which every update used to download again — review 16 Nov 2026)
    const keys = await caches?.keys() ?? [];
    await Promise.all(keys.filter(k => !k.startsWith('fbc-data')).map(k => caches.delete(k)));
  } catch { /* whatever is left, the new URL still wins */ }
  // Reloading into the old files is the loop the owner saw: the new files were checked above.

  set(sessionStorage, TARGET, latest);
  set(sessionStorage, TARGET_AT, String(Date.now()));
  const params = new URLSearchParams(location.search);
  params.set('updated', Date.now());
  location.replace(location.pathname + '?' + params + location.hash);
}

// The update loop (18 Sept 2026): only index.html, app.js and styles.css carry
// a ?v=. Every other module — this one included — is asked for by its bare
// name, and GitHub Pages lets the browser keep those for ten minutes
// (max-age=600). With the worker unregistered, the fresh page imported a
// stale update.js, still said the old VERSION, offered the update again, and
// round it went until the copies expired or the app was closed. So before the
// reload, every shell file is fetched with cache: 'reload', which replaces the
// browser's copy. The list is the new sw.js's own SHELL (so a module added in
// this release is included) plus whatever this page has loaded.
async function refreshShell() {
  const urls = new Set();
  try {
    const sw = await (await fetch('sw.js', { cache: 'reload' })).text();
    for (const m of sw.matchAll(/'(\.\/[^']*)'/g)) urls.add(new URL(m[1], location.href).href);
  } catch { /* offline or moved: the loaded list below still helps */ }
  for (const e of performance.getEntriesByType('resource')) {
    if (e.name.startsWith(location.origin) && !/version\.json/.test(e.name)) urls.add(e.name.split('#')[0]);
  }
  await Promise.all([...urls].map(u =>
    fetch(u, { cache: 'reload', credentials: 'same-origin' }).catch(() => null)));
}

// The module that carries the number, fetched past every cache: does it say the new one?
async function arrived(latest) {
  try {
    const txt = await (await fetch('js/update.js?probe=' + Date.now(), { cache: 'reload' })).text();
    return txt.includes(`VERSION = '${latest}'`);
  } catch { return false; }
}

// Tidy the address after an update, and confirm the new version once.
function afterUpdate() {
  const params = new URLSearchParams(location.search);
  if (params.has('updated')) {
    params.delete('updated');
    const q = params.toString();
    history.replaceState(history.state, '',
      location.pathname + (q ? '?' + q : '') + location.hash);
  }
  const pressed = get(sessionStorage, TARGET) === VERSION;
  if (pressed) {
    try { sessionStorage.removeItem(TARGET); sessionStorage.removeItem(TARGET_AT); } catch { /* ignore */ }
  }

  const last = get(localStorage, LAST);
  set(localStorage, LAST, VERSION);
  if (!pressed && (!last || last === VERSION)) return;    // first run, or nothing changed

  // A new version arrived — by Update now, or just by reloading, which on a
  // network-first worker is the usual way and used to show only a note in the
  // corner for four seconds. The bar picks up here either way.
  justUpdated = true;
  progress(85, `Opening ${VERSION}`, true);
  // app.js finishes it; if it never can (signed out, offline), do not leave it up
  setTimeout(finishUpdate, 30_000);

  if (get(localStorage, 'fbc_session')) return;   // signed in: the top bar says it
  const note = el('div', 'update-done', `Updated to ${VERSION}`);
  note.setAttribute('role', 'status');
  document.body.append(note);
  setTimeout(() => note.remove(), 4500);
}

// What the server says is current — for the card above and for Settings.
// null when offline: not worth a word.
export async function checkForUpdate() {
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export const updateNow = latest => update(latest);
