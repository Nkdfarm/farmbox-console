// Supabase over plain fetch. No SDK, no build step — the console is served as
// static files and everything the browser needs is the project URL and the
// public anon key, which is public by design: row-level security is the guard.

export const URL_BASE = 'https://azfiajzhzewjcblbltmp.supabase.co';
export const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6ZmlhanpoemV3amNibGJsdG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDg5NzQsImV4cCI6MjEwNDc4NDk3NH0.0wakTe-gKANg4w6sfxyNfn8nhfgDGW2O7O60WvMI1mY';

const KEY = 'fbc_session';
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }

export const getSession = () => session;

function save(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); }
  catch { /* private window: the session lives for this tab only */ }
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message); this.name = 'ApiError'; this.status = status; this.body = body;
  }
}

async function raw(path, opts = {}, token) {
  const res = await fetch(URL_BASE + path, {
    ...opts,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error_description || body?.error?.message || body?.error ||
                body?.message || body?.msg || `request failed (${res.status})`;
    throw new ApiError(String(msg), res.status, body);
  }
  return body;
}

export async function signIn(email, password) {
  const s = await raw('/auth/v1/token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  save({ ...s, expires_at: Date.now() + (s.expires_in ?? 3600) * 1000 });
  return session;
}

export function signOut() {
  save(null);
  // What this device kept for offline reading belongs to the person who read
  // it; the next person at the office computer must not open the console on it.
  forgetAll();
}

async function refresh() {
  if (!session?.refresh_token) throw new ApiError('signed out', 401);
  let s;
  try {
    s = await raw('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
  } catch (e) {
    // No signal is not a dead session. A refresh that never reached the server
    // used to land here too and throw a good session away, so an hour offline
    // meant signing in again — which cannot be done offline.
    if (!(e instanceof ApiError)) throw e;
    // A refused refresh is a dead session however it is worded: the token
    // expired, somebody revoked it, or the account itself is gone. Auth answers
    // 400 for that, and a 400 used to leave the console sitting in an empty
    // shell with nothing to sign in with. Whatever the wording, it is a 401.
    save(null);
    throw new ApiError('Your session has ended. Sign in again.', 401, e.body);
  }
  save({ ...s, expires_at: Date.now() + (s.expires_in ?? 3600) * 1000 });
  return session;
}

// It refreshes a minute before expiry, and once more if the server disagrees
// about the clock.
async function live(path, opts) {
  if (Date.now() > (session.expires_at ?? 0) - 60_000) await refresh();
  try {
    return await raw(path, opts, session.access_token);
  } catch (e) {
    if (e.status !== 401) throw e;
    await refresh();
    return raw(path, opts, session.access_token);
  }
}

// ── offline: read only ─────────────────────────────────────────────────────
// Every read that succeeds is kept on this device; when the network is gone
// the same read is answered from that copy, and anything that would change the
// farm is refused. Nothing is queued: the phone app is the offline-first
// client, and a plan validated against a copy from this morning is not a
// decision anybody should find waiting on the server afterwards.
//
// A read is a GET or one of the RPCs below. An RPC not on the list is treated
// as a write, which is the safe mistake: a new read page that nobody added here
// says "needs a connection" offline, rather than a write replaying an old "ok".
const READ_RPCS = new Set([
  'crop_calendar', 'crop_detail', 'crop_library', 'crop_map', 'dashboard',
  'family_tree', 'farm_market', 'farm_models', 'farm_network', 'harvests',
  'issues', 'labour_week', 'maintenance', 'people', 'price_table', 'procedure',
  'procedures', 'purchasing', 'reports',
]);
const DATA_CACHE = 'fbc-data';   // sw.js leaves caches with this prefix alone

const isRead = (path, opts) => {
  if ((opts.method || 'GET') === 'GET') return true;
  const m = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
  return !!m && READ_RPCS.has(m[1]);
};

// One entry per person, per request and per argument list, under a URL the
// Cache API accepts. The person is part of the key: a franchisor and a farm
// manager at the same desk see different farms.
const keyOf = (path, opts) =>
  'https://offline.farmbox/' + encodeURIComponent(session?.user?.id || 'me') + path +
  (opts.body ? (path.includes('?') ? '&' : '?') + 'body=' + encodeURIComponent(opts.body) : '');

async function remember(key, body) {
  try {
    const c = await caches.open(DATA_CACHE);
    await c.put(key, new Response(JSON.stringify({ saved_at: Date.now(), body }),
      { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* no Cache API (private window): offline simply has nothing to show */ }
}

async function recall(key) {
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(key);
    return hit ? await hit.json() : null;
  } catch { return null; }
}

function forgetAll() {
  try { caches.delete(DATA_CACHE); } catch { /* nothing kept */ }
}

// ── connected / offline ────────────────────────────────────────────────────
// `online` is what the last request found, not only what the browser guesses:
// navigator.onLine says true on a Wi-Fi with no internet behind it.
// `savedAt` is the oldest copy shown since the page was opened, so the banner
// can say how old what is on screen is.
const net = { online: navigator.onLine !== false, savedAt: null };
const listeners = new Set();
let probeTimer = null;

export const connection = () => ({ ...net });
export function onConnection(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const emit = () => listeners.forEach(cb => { try { cb({ ...net }); } catch { /* a listener's problem */ } });

function setOnline(on) {
  if (on === net.online) return;
  net.online = on;
  clearInterval(probeTimer);
  probeTimer = on ? null : setInterval(probe, 15_000);
  emit();
}

// A new page starts with nothing old on it.
export function newPage() {
  if (net.savedAt === null) return;
  net.savedAt = null;
  emit();
}

function servedFromCopy(t) {
  if (net.savedAt !== null && net.savedAt <= t) return;
  net.savedAt = t;
  emit();
}

// Is Supabase reachable? Any answer at all, even a refusal, means yes.
export async function probe() {
  try {
    await fetch(URL_BASE + '/auth/v1/health', { headers: { apikey: ANON }, cache: 'no-store' });
    setOnline(true);
  } catch { setOnline(false); }
}

addEventListener('offline', () => setOnline(false));
addEventListener('online', probe);
if (!net.online) probeTimer = setInterval(probe, 15_000);

export const OFFLINE_WRITE = 'Offline — the console is read only. This needs a connection.';

// Every call goes through here.
export async function api(path, opts = {}) {
  if (!session) throw new ApiError('sign in first', 401);
  const read = isRead(path, opts);
  try {
    const body = await live(path, opts);
    setOnline(true);
    if (read) remember(keyOf(path, opts), body);
    return body;
  } catch (e) {
    // The server answered: that is a real answer, online or not.
    if (e instanceof ApiError) { if (e.status) setOnline(true); throw e; }
    // fetch itself failed: no network, or Supabase unreachable.
    setOnline(false);
    if (!read) throw new ApiError(OFFLINE_WRITE, 0);
    const copy = await recall(keyOf(path, opts));
    if (!copy) {
      throw new ApiError('Offline — this was never opened on this device while connected, ' +
        'so there is no copy of it to show.', 0);
    }
    servedFromCopy(copy.saved_at);
    return copy.body;
  }
}

export const rpc = (name, args) =>
  api('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args ?? {}) });

export const fn = (name, body) =>
  api('/functions/v1/' + name, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const select = (table, query) => api(`/rest/v1/${table}?${query}`);

export const patch = (table, query, body) =>
  api(`/rest/v1/${table}?${query}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { Prefer: 'return=representation' },
  });

export const me = () => api('/auth/v1/user');
