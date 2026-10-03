// Naked Heart (was Naked Console, FarmBox Console) — service worker.
//
// Network first, cache second, deliberately. The phone app was bitten once by a
// cache-first worker that kept serving a shipped-and-fixed bug for days
// (Ugly200), and this console changes every week. So a person online always
// gets what was last deployed, and the cache exists for the walk between the
// office and the container where the signal drops.
//
// Bump CACHE when the shell changes; the old one is deleted on activate.
// TAG is the ?v= index.html puts on styles.css and app.js: the two must match
// (the precached URL is the requested URL), so bump both together.
const TAG = '20261003c';
const CACHE = 'farmbox-console-' + TAG;

const SHELL = [
  './',
  './index.html',
  './styles.css?v=' + TAG,
  './manifest.json',
  './js/app.js?v=' + TAG,
  // every module: app.js imports them all at start, and one missing offline leaves a blank console
  './js/aicost.js',
  './js/api.js',
  './js/assistant.js',
  './js/baskets.js',
  './js/cases.js',
  './js/catalog.js',
  './js/connect.js',
  './js/crop-edit.js',
  './js/cropdb.js',
  './js/crops.js',
  './js/customers.js',
  './js/dashboard.js',
  './js/families.js',
  './js/farm.js',
  './js/feedback.js',
  './js/forecast.js',
  './js/harvest.js',
  './js/hours.js',
  './js/ipm.js',
  './js/issues.js',
  './js/maintenance.js',
  './js/money.js',
  './js/network.js',
  './js/orders.js',
  './js/people.js',
  './js/prices.js',
  './js/procedure-edit.js',
  './js/procedures.js',
  './js/purchasing.js',
  './js/reports.js',
  './js/robot.js',
  './js/scouting.js',
  './js/settings.js',
  './js/sump.js',
  './js/timeline.js',
  './js/trapmap.js',
  './js/treatments.js',
  './js/ui.js',
  './js/update.js',
  './js/validation.js',
  './js/viewer.js',
  './js/weather.js',
  './js/week.js',
  './js/yield.js',
  './scale-card.html',
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
        // a URL with a query other than ?v= (version.json?t=…, update.js?probe=…, ?updated=…) is
        // asked once and never again: keeping each would grow the cache by an entry a minute
        if (res && res.ok && (!url.search || /^\?v=[^&]*$/.test(url.search))) {
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
