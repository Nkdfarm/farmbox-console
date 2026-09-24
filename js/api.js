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
    // the console reacts wherever it is, not only at start-up (0.7.112): app.js signs out and shows the form
    dispatchEvent(new CustomEvent('fbc:session-ended'));
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
  'family_tree', 'farm_market', 'farm_models', 'farm_network', 'harvest_overview',
  'issues', 'ipm', 'labour_week', 'maintenance', 'market_trends', 'people', 'price_table', 'procedure',
  'procedures', 'purchasing', 'reports', 'system_catalog', 'integration_status', 'task_families',
  'farm_holidays', 'scouting_day', 'zone_photos', 'pest_catalog', 'cases', 'case_detail', 'pest_overview', 'crop_pests', 'scouting_dates', 'pest_dot',
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

// ── connected / connecting / offline ───────────────────────────────────────
// `phase` is what the requests found, not only what the browser guesses:
// navigator.onLine says true on a Wi-Fi with no internet behind it.
// A failed request does not declare the console offline on the spot: it tries
// the server CONNECT_TRIES times, CONNECT_GAP apart, and the top bar shows that
// as "Connecting" with a bar filling up (styles.css times the fill to the gap).
// Only then is it Offline, and it keeps asking quietly every 15 s.
// `savedAt` is the oldest copy shown since the page was opened, so the banner
// can say how old what is on screen is.
export const CONNECT_TRIES = 3;
export const CONNECT_GAP = 1500;
const net = { phase: 'online', online: true, attempt: 0, attempts: CONNECT_TRIES, savedAt: null };
const listeners = new Set();
let probeTimer = null;
let connecting = null;

export const connection = () => ({ ...net });
export function onConnection(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const emit = () => listeners.forEach(cb => { try { cb({ ...net }); } catch { /* a listener's problem */ } });

function setPhase(phase, attempt = 0) {
  if (phase === net.phase && attempt === net.attempt) return;
  net.phase = phase;
  net.online = phase === 'online';
  net.attempt = attempt;
  clearInterval(probeTimer);
  probeTimer = phase === 'offline'
    ? setInterval(async () => { if (await reachable()) setPhase('online'); }, 15_000)
    : null;
  emit();
}
const setOnline = on => { if (on) setPhase('online'); else reconnect(); };

// Is Supabase reachable? Any answer at all, even a refusal, means yes. Four
// seconds at most: a Wi-Fi with no internet behind it can hang for a minute.
async function reachable() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    await fetch(URL_BASE + '/auth/v1/health',
      { headers: { apikey: ANON }, cache: 'no-store', signal: ctl.signal });
    return true;
  } catch { return false; }
  finally { clearTimeout(t); }
}

// Try to reach the server, showing each attempt; ends Connected or Offline.
// One run at a time — every failed request during it joins the same run.
export function reconnect() {
  if (connecting) return connecting;
  connecting = (async () => {
    for (let i = 1; i <= CONNECT_TRIES; i++) {
      // a real request got through meanwhile: that settles it
      if (i > 1 && net.phase === 'online') return true;
      setPhase('connecting', i);
      const t0 = Date.now();
      if (await reachable()) { setPhase('online'); return true; }
      if (i < CONNECT_TRIES) await new Promise(r => setTimeout(r, Math.max(0, CONNECT_GAP - (Date.now() - t0))));
    }
    if (net.phase === 'online') return true;
    setPhase('offline');
    return false;
  })().finally(() => { connecting = null; });
  return connecting;
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

addEventListener('offline', () => reconnect());
addEventListener('online', () => reconnect());

export const OFFLINE_WRITE = 'Offline — the console is read only. This needs a connection.';

// Every call goes through here.
// the last change this tab made: a copy kept before it is out of date (0.7.112)
let lastWrite = 0;
export async function api(path, opts = {}) {
  if (!session) throw new ApiError('sign in first', 401);
  const read = isRead(path, opts);
  try {
    const body = await live(path, opts);
    setOnline(true);
    if (read) remember(keyOf(path, opts), body); else lastWrite = Date.now();
    return body;
  } catch (e) {
    // The server answered: that is a real answer, online or not.
    if (e instanceof ApiError) { if (e.status) setOnline(true); throw e; }
    // fetch itself failed: no network, or Supabase unreachable. Find out which
    // in the background; the copy is shown at once rather than after the tries.
    if (net.phase === 'online') setOnline(false);
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

// The copy of a read kept from last time, without asking the server (0.7.106): a page
// may draw it at once and replace it when the fresh answer comes. null when none.
export async function cachedRpc(name, args) {
  if (!READ_RPCS.has(name)) return null;
  const hit = await recall(keyOf('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args ?? {}) }));
  // a copy from before this tab changed something would show the old state for a moment
  return hit && hit.saved_at > lastWrite ? hit.body : null;
}

// A page that opens at once (0.7.107). reads = [[name, args, optional?], …].
// With a kept copy of every required read, show(values) draws it straight away;
// then the server is asked, and show(values) runs again only when the answer
// differs — nothing redraws under somebody for no reason. Without a copy,
// waiting() draws the loading state first. failed(e) only when nothing could be
// shown. stillHere() false (the person moved on) drops the late answer.
// fresh: after a change the kept copy is out of date — skip it, keep the screen until the answer.
// Only the latest call draws (0.7.112): every page draws into the same #page, so a
// page left behind — another page, another farm, an older period — must not paint over it.
let openSeq = 0;
export async function openFast(reads, { show, waiting, failed, stillHere, fresh = false }) {
  const mine = ++openSeq;
  const old = fresh ? reads.map(() => null) : await Promise.all(reads.map(([n, a]) => cachedRpc(n, a)));
  if (mine !== openSeq) return;
  const had = reads.every(([, , optional], i) => optional || old[i] != null) ? JSON.stringify(old) : null;
  if (had) show(old, false); else if (!fresh) waiting?.();
  let now;
  try {
    now = await Promise.all(reads.map(([n, a, optional]) => optional ? rpc(n, a).catch(() => null) : rpc(n, a)));
  } catch (e) { if (!had && mine === openSeq) failed?.(e); return; }
  if (mine !== openSeq || (stillHere && !stillHere())) return;
  if (had && JSON.stringify(now) === had) return;
  show(now, true);
}

export const fn = (name, body) =>
  api('/functions/v1/' + name, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const select = (table, query) => api(`/rest/v1/${table}?${query}`);

export const patch = (table, query, body) =>
  api(`/rest/v1/${table}?${query}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { Prefer: 'return=representation' },
  });

export const me = () => api('/auth/v1/user');
