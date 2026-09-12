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

export function signOut() { save(null); }

async function refresh() {
  if (!session?.refresh_token) throw new ApiError('signed out', 401);
  let s;
  try {
    s = await raw('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
  } catch (e) {
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

// Every call goes through here: it refreshes a minute before expiry, and once
// more if the server disagrees about the clock.
export async function api(path, opts = {}) {
  if (!session) throw new ApiError('sign in first', 401);
  if (Date.now() > (session.expires_at ?? 0) - 60_000) await refresh();
  try {
    return await raw(path, opts, session.access_token);
  } catch (e) {
    if (e.status !== 401) throw e;
    await refresh();
    return raw(path, opts, session.access_token);
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
