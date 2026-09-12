// FarmBox Console — service worker.
//
// Network first, cache second, deliberately. The phone app was bitten once by a
// cache-first worker that kept serving a shipped-and-fixed bug for days
// (Ugly200), and this console changes every week. So a person online always
// gets what was last deployed, and the cache exists for the walk between the
// office and the container where the signal drops.
//
// Bump CACHE when the shell changes; the old one is deleted on activate.
const CACHE = 'farmbox-console-20260912f';

const SHELL = [
  './',
  './index.html',
  './styles.css?v=20260912f',
  './manifest.json',
  './js/app.js?v=20260912f',
  './js/api.js',
  './js/ui.js',
  './js/people.js',
  './js/week.js',
  './js/farm.js',
  './js/crops.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  // addAll fails whole if any one URL 404s, which would leave no cache at all
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never cache a write
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // Supabase answers for itself

  // no-cache, not the browser's default: only app.js and styles.css carry a ?v=,
  // so a static host's heuristic caching can serve an hour-old api.js against a
  // fresh app.js — the two halves of a change, out of step, with nothing on
  // screen to say so. Revalidating every same-origin GET costs a 304 and makes
  // "deployed" mean "loaded".
  e.respondWith(
    fetch(req.mode === 'navigate' ? req : new Request(req.url, { cache: 'no-cache' }))
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        // offline: the exact URL, then the same file under a different ?v=,
        // then the shell for a navigation
        const hit = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html', { ignoreSearch: true });
          if (shell) return shell;
        }
        return new Response('Offline, and this page was never cached.', {
          status: 503, headers: { 'Content-Type': 'text/plain' } });
      })
  );
});
