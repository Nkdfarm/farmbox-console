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

export const VERSION = '0.7.2';

const DISMISSED = 'fbc_update_dismissed';
const TARGET    = 'fbc_update_target';
const LAST      = 'fbc_last_version';
const EVERY_MS  = 5 * 60 * 1000;

const get = (store, k) => { try { return store.getItem(k); } catch { return null; } };
const set = (store, k, v) => { try { store.setItem(k, v); } catch { /* private window */ } };

export function watchForUpdates() {
  afterUpdate();
  check();
  setInterval(check, EVERY_MS);
  // Coming back to a tab left open for a day is exactly when this matters.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

async function check() {
  const latest = (await checkForUpdate())?.version;
  if (!latest || latest === VERSION) return;
  if (get(sessionStorage, DISMISSED) === latest) return;

  // "Update now" was already pressed for this version and here we are, still
  // on the old one. Say that instead of offering the same button again.
  show(latest, get(sessionStorage, TARGET) === latest);
}

function show(latest, stuck) {
  document.getElementById('updateCard')?.remove();

  const card = el('div', 'update-card');
  card.id = 'updateCard';
  card.setAttribute('role', 'status');

  const text = el('div', 'update-text');
  text.append(el('b', null, `Version ${latest} is ready`));
  text.append(el('span', null, stuck
    ? 'The update did not finish — close every FarmBox Console tab and open it again.'
    : `You are on ${VERSION}. Nothing you have typed is lost by updating.`));

  const go = el('button', 'btn btn-primary btn-sm', 'Update now');
  go.onclick = () => update(latest);

  const no = el('button', 'btn btn-ghost btn-sm', '✕');
  no.setAttribute('aria-label', 'Not now');
  no.onclick = () => { set(sessionStorage, DISMISSED, latest); card.remove(); };

  card.append(el('span', 'update-mark', '✦'), text, go, no);
  document.body.append(card);
}

async function update(latest) {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations() ?? [];
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches?.keys() ?? [];
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch { /* whatever is left, the new URL still wins */ }

  set(sessionStorage, TARGET, latest);
  const params = new URLSearchParams(location.search);
  params.set('updated', Date.now());
  location.replace(location.pathname + '?' + params + location.hash);
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
  if (get(sessionStorage, TARGET) === VERSION) {
    try { sessionStorage.removeItem(TARGET); } catch { /* ignore */ }
  }

  const last = get(localStorage, LAST);
  set(localStorage, LAST, VERSION);
  if (!last || last === VERSION) return;    // first run, or nothing changed

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
