// FarmBox Console — service worker.
//
// Network first, cache second, deliberately. The phone app was bitten once by a
// cache-first worker that kept serving a shipped-and-fixed bug for days
// (Ugly200), and this console changes every week. So a person online always
// gets what was last deployed, and the cache exists for the walk between the
// office and the container where the signal drops.
//
// Bump CACHE when the shell changes; the old one is deleted on activate.
const CACHE = 'farmbox-console-20260921r';

const SHELL = [
  './',
  './index.html',
  './styles.css?v=20260921r',
  './manifest.json',
  './js/app.js?v=20260921r',
  './js/api.js',
  './js/ui.js',
  './js/people.js',
  './js/week.js',
  './js/farm.js',
  './js/crops.js',
  './js/dashboard.js',
  './js/weather.js',
  './js/update.js',
  './js/procedures.js',
  './js/procedure-edit.js',
  './js/catalog.js',
  './js/crop-edit.js',
  './js/cropdb.js',
  './js/maintenance.js',
  './js/purchasing.js',
  './js/prices.js',
  './js/reports.js',
  './js/network.js',
  './js/issues.js',
  './js/harvest.js',
  './js/settings.js',
  './version.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // One file at a time, not addAll: addAll fails whole if any one URL 404s and
  // would leave no cache at all. And each is fetched with cache: 'reload', so
  // installing a new worker cannot fill its fresh cache from the browser's
  // stale one.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u =>
      fetch(u, { cache: 'reload' })
        .then(r => (r.ok ? c.put(u, r) : null))
        .catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    // only this worker's own old shells: fbc-data is what the page kept for
    // reading offline (api.js) and outlives a new version of the console
    .then(keys => Promise.all(keys
      .filter(k => k.startsWith('farmbox-console-') && k !== CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never cache a write
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // Supabase answers for itself

  // no-cache, not the browser's default, and for the page itself as much as
  // for its parts. Only app.js and styles.css carry a ?v=, so a static host's
  // caching can pair a fresh script with an hour-old module — or, worse, serve
  // yesterday's index.html against today's app.js, which is a rail that says
  // one thing and a page that does another. Revalidating costs a 304 and makes
  // "deployed" mean "loaded".
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
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
