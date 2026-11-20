// FarmNet pages: the shared frame (ask/send, readings helpers, kept answers, pins, page, card, table, centres)
import { fn, rpc } from '../api.js';
import { el, pageHead, toast, loading, farmDate, farmLocal, pref, addDays, ymd, icon } from '../ui.js';

const FN = 'farmnet';
// ── the last answers, kept on this computer (stale while revalidate) ────────
// FarmNet is slow to answer (the function asks the controller on the farm), and a page that waits for it is white.
// So every answer is also kept in localStorage; opening a page first draws it from what was kept (dimmed, with the time
// of the reading, nothing to press), then asks FarmNet and draws it again. A page that needs an answer never kept
// shows "Asking FarmNet…" as before. Kept answers go on sign-out (forgetFarmnet) and after 7 days.
// When FarmNet does not answer (its server in China goes quiet for a minute or two at times: every call a 504 after
// ~10 s, 20 Nov 2026), or this computer is offline, a read falls back on its kept answer and the page is drawn from it
// with a small "not connected · last update" badge instead of an error (owner, 20 Nov 2026).
const KEEP = 'fbc_fnc_', KEEP_MAX = 7 * 24 * 3600000, KEEP_ONE = 300000;   // characters of one answer
let replaying = false, missed = false, oldest = Infinity, fellBack = Infinity;
// FarmNet or the network did not answer (an answer that refuses is not this: it is shown as it is)
const unreached = e => {
  const st = Number(e?.status);
  return st === 0 || st === 503 || st === 504 || st === 546 || /could not be reached|did not answer in time/i.test(e?.message || '');
};
export const isReplay = () => replaying;                 // a memo must not keep an answer drawn from the copy
const stable = a => JSON.stringify(a, Object.keys(a || {}).sort());
// a history asks "the last 24 h" with the clock in its arguments: kept by its length, not by the minute it was asked
const keyArgs = a => {
  const s = fnTime(a?.startTime), e = fnTime(a?.endTime);
  if (s === null || e === null) return a;
  const { startTime, endTime, ...rest } = a;
  return { ...rest, span: Math.round((e - s) / 60000) };
};
const keepGet = k => {
  const raw = pref.get(k);
  if (!raw) return null;
  try { const c = JSON.parse(raw); return c && Date.now() - c.at < KEEP_MAX ? c : null; } catch { return null; }
};
function keepPut(k, v) {
  if (v === undefined) return;
  let raw;
  try { raw = JSON.stringify({ at: Date.now(), v }); } catch { return; }
  if (raw.length > KEEP_ONE) return;
  try { localStorage.setItem(k, raw); }
  catch { forgetFarmnet(); try { localStorage.setItem(k, raw); } catch { /* full, or a private window */ } }
}
// answers older than KEEP_MAX are dropped once, when the console loads (keepGet only ignores them)
try {
  Object.keys(localStorage).filter(k => k.startsWith(KEEP)).forEach(k => {
    let at = 0; try { at = JSON.parse(localStorage.getItem(k))?.at || 0; } catch { /* unreadable: dropped */ }
    if (Date.now() - at >= KEEP_MAX) localStorage.removeItem(k);
  });
} catch { /* no storage */ }
export function forgetFarmnet() {
  try { Object.keys(localStorage).filter(k => k.startsWith(KEEP)).forEach(k => localStorage.removeItem(k)); } catch { /* nothing kept */ }
}
// read the network, keep the answer; while replaying: the kept answer or a miss (the whole replay is then dropped)
export function cached(k, load) {
  if (replaying) {
    const c = keepGet(k);
    if (!c) { missed = true; return Promise.reject(new Error('not kept')); }
    oldest = Math.min(oldest, c.at);
    return Promise.resolve(c.v);
  }
  return load().then(v => { keepPut(k, v); return v; }, e => {
    const c = unreached(e) ? keepGet(k) : null;
    if (!c) throw e;
    fellBack = Math.min(fellBack, c.at);
    return c.v;
  });
}
export const ask = (farm, action, args = {}) =>
  cached(`${KEEP}${farm.id}|${action}|${stable(keyArgs(args))}`, () => fn(FN, { farm: farm.id, action, args }, { quiet: true }).then(r => r?.data));
// FarmNet now, never the kept copy: what an editor builds a change on (the answer is still kept for the pages)
export const askNow = (farm, action, args = {}) => {
  const k = `${KEEP}${farm.id}|${action}|${stable(keyArgs(args))}`;
  return fn(FN, { farm: farm.id, action, args }, { quiet: true }).then(r => { keepPut(k, r?.data); return r?.data; });
};
export const commandLog = (farm, limit) =>
  cached(`${KEEP}${farm.id}|log|${limit}`, () => rpc('farmnet_commands', { p_farm: farm.id, p_limit: limit }, { quiet: true }));
export const send = (farm, action, args, changes) => fn(FN, { farm: farm.id, action, args, changes });
export const soft = p => Promise.resolve(p).then(v => ({ v }), e => ({ e: e?.message || String(e) }));   // one section failing does not blank the page

export const num = v => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : null; };
export const NO_SENSOR = n => n === 65535 || n === -100;           // FarmNet's "no sensor" values
export const show = (v, u) => {
  const n = num(v);
  if (n !== null && NO_SENSOR(n)) return '—';
  return `${v ?? '—'}${u ? ' ' + u : ''}`;
};
export const secs = s => { const n = Number(s) || 0; return n >= 3600 ? `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min` : n >= 60 ? `${Math.round(n / 60)} min` : `${n} s`; };
export const nice = s => s ? farmLocal(s).replace('T', ' ').slice(5) : '—';   // the farm's clock, "11-05 17:26" like FarmNet's own times
// FarmNet's own times are the farm's wall clock, "2026-11-05 08:00[:00]"
export const fnTime = s => { const t = s ? new Date(String(s).replace(' ', 'T')).getTime() : NaN; return Number.isFinite(t) ? t : null; };
export const short = s => s ? String(s).slice(5, 16) : '—';        // "11-05 08:00"
export const nowLocal = (minusMin = 0) => farmLocal(new Date(Date.now() - minusMin * 60000).toISOString()).replace('T', ' ');
const HUES = [205, 28, 145, 285, 350, 55, 180, 320];
export const colour = i => `hsl(${HUES[i % HUES.length]} 60% 52%)`;

// ── what is kept between tabs (per farm): who may control, the sensor list ──
const memo = new Map();
async function kept(farm, key, ms, load) {
  if (replaying) return load();               // a copy is never remembered as if it were fresh
  const k = farm.id + '|' + key, m = memo.get(k);
  if (m && Date.now() - m.at < ms) return m.p;
  const p = load();
  memo.set(k, { at: Date.now(), p });
  p.catch(() => memo.delete(k));            // a failure is not kept
  return p;
}
const helloKey = farm => `${KEEP}${farm.id}|hello`;
// hello is the platform's own answer (not FarmNet's): offline, the kept one stands in, and is not remembered as fresh
const helloOf = farm => kept(farm, 'hello', 5 * 60000, () => fn(FN, { farm: farm.id, action: 'hello' }, { quiet: true })
  .then(h => { keepPut(helloKey(farm), h); return h; }, e => {
    const c = unreached(e) ? keepGet(helloKey(farm)) : null;
    if (!c) throw e;
    memo.delete(farm.id + '|hello');
    return c.v;
  }));

// every signal source FarmNet has, flat: { id, label, unit, dec, group, path }
export const GROUPS = { general: 'General', climate: 'Climate', irrigate: 'Irrigation', energy: 'Energy' };
export const sourcesOf = farm => kept(farm, 'sources', 10 * 60000, async () => {
  const d = await ask(farm, 'sources', { climate: 1, irrigate: 1, general: 1, energy: 1 }) || {};
  const out = [];
  const walk = (n, group, path) => {
    const label = String(n.label ?? '').replace(/\s+/g, ' ').trim();
    if (Array.isArray(n.children) && n.children.length) { n.children.forEach(c => walk(c, group, label ? [...path, label] : path)); return; }
    if (typeof n.id === 'string' && n.id.includes('/')) out.push({ id: n.id, label, unit: n.unit || '', dec: Number(n.decm ?? 2), group, path });
  };
  Object.entries(d).forEach(([g, list]) => (Array.isArray(list) ? list : []).forEach(n => walk(n, g, [])));
  return out;
});

// the sensors on the Overview, chosen on this computer (Sensors tab); until then the weather station and the greenhouse sensor
const PIN_KEY = farm => 'fbc_fn_pins_' + farm.id;
const DEFAULT_PINS = ['Outdoor Temp', 'Outdoor RH', 'Outdoor Light', 'Wind Speed', 'Air Temp', 'Relative RH', 'Light Intensity', 'Dissolved Oxygen'];
export const MAX_PINS = 8;
export function pinsOf(farm, sources) {
  let ids = null;
  try { ids = JSON.parse(pref.get(PIN_KEY(farm)) || 'null'); } catch { ids = null; }
  if (Array.isArray(ids)) return ids.map(i => sources.find(s => s.id === i)).filter(Boolean).slice(0, MAX_PINS);
  const picked = [];
  DEFAULT_PINS.forEach(l => { const s = sources.find(x => x.group === 'general' && x.label === l); if (s) picked.push(s); });
  return picked.slice(0, MAX_PINS);
}
export const setPins = (farm, list) => pref.set(PIN_KEY(farm), JSON.stringify(list.map(s => s.id)));

// ── the frame every tab shares ──────────────────────────────────────────────
let token = 0;   // a newer page or refresh wins: an older one draws nothing
const READ_ONLY = 'Read only: the farm admin and the farm manager may send commands.';

// 19 Nov 2026 (owner: "more compact"): no sentence under the tabs any more (the blurb the tabs pass is not shown; only
// a person who may not send commands is told so), and Refresh is a button with no text, lifted by the shell into the
// tool bar next to the unit buttons (class tb-refresh, app.js collectActions). What was printed beside it — the time of
// the reading, "again every minute", "updating…" — is its tooltip.
const refreshButton = (onclick, tip) => {
  const b = el('button', 'btn btn-sm btn-icon tb-refresh'); b.type = 'button';
  b.append(icon('refresh')); b.setAttribute('aria-label', 'Refresh'); b.title = tip; b.onclick = onclick;
  return b;
};
// "Not connected to FarmNet · last update 20 Nov 12:11", over a page drawn from what was kept (null: nothing kept)
const RETRY = 60000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = at => { const s = farmLocal(new Date(at).toISOString()); return `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(11, 16)}`; };
function offlineBadge(at) {
  const b = el('div', 'fn-offline'); b.setAttribute('role', 'status');
  const x = el('span', 'fn-offline-x', '✕'); x.setAttribute('aria-hidden', 'true');
  b.append(x, el('span', null, at ? `Not connected to FarmNet · last update ${when(at)}` : 'Not connected to FarmNet · nothing kept on this computer yet'));
  b.title = 'FarmNet did not answer. It is asked again every minute.';
  return b;
}
// a head with nothing to say is not drawn (its buttons are in the tool bar)
const headOf = (note, refresh) => {
  const h = pageHead(null, note, refresh);
  if (!note) h.style.display = 'none';
  return h;
};

export async function page(mount, farm, blurb, draw, opts = {}) {
  const my = ++token;
  const again = q => page(mount, farm, blurb, draw, { ...opts, quiet: q });
  const hello = helloOf(farm);              // FarmNet is asked at once, while the kept copy is drawn
  hello.catch(() => {});
  let staleBtn = null;                      // the Refresh of the kept copy on screen, to say when FarmNet did not answer
  const refreshBtn = tip => refreshButton(() => page(mount, farm, blurb, draw, { ...opts, quiet: false, noStale: true }), tip);

  // 1. the kept copy, if there is one and it holds everything the page asks
  let shownStale = false;
  const kh = !opts.quiet && !opts.noStale ? keepGet(helloKey(farm)) : null;
  if (kh?.v?.connected) {
    const h0 = kh.v;
    const ctx0 = { farm, may: false, actions: h0.actions || {}, fresh: false, stale: true, live: () => mount.isConnected && my === token, redraw: () => {} };
    const body0 = el('div', 'fn-page fn-stale');
    replaying = true; missed = false; oldest = Infinity;
    let ok = true;
    try { await draw(ctx0, body0); } catch { ok = false; } finally { replaying = false; }
    if (ok && !missed && my === token && mount.isConnected) {
      const at = Number.isFinite(oldest) ? oldest : kh.at;
      staleBtn = refreshBtn(`Refresh · last reading ${farmLocal(new Date(at).toISOString()).slice(5, 16).replace('T', ' ')} · updating…`);
      mount.replaceChildren(headOf(null, staleBtn), body0);
      mount.dataset.fnAt = String(at);
      shownStale = true;
    }
  }
  if (my !== token) return;
  if (!opts.quiet && !shownStale) { mount.textContent = ''; mount.append(loading('Asking FarmNet…')); }

  // 2. FarmNet itself
  const onScreen = shownStale || (opts.quiet && mount.querySelector('.fn-page'));
  // read again later, while the page is on screen (not while the window is hidden, not while a drawer is open)
  const later = ms => {
    const tick = () => {
      if (!mount.isConnected || my !== token) return;
      if (document.visibilityState !== 'visible' || document.querySelector('aside.drawer')) { setTimeout(tick, 15000); return; }
      again(true);
    };
    setTimeout(tick, ms);
  };
  const failedAsk = e => {
    // a failed re-read keeps what is on screen; FarmNet not answering is said by the badge, anything else by a toast
    if (unreached(e)) {
      const at = Number(mount.dataset.fnAt) || Date.now();
      mount.querySelectorAll('.fn-page.fn-stale').forEach(p => p.classList.remove('fn-stale'));
      const pg = mount.querySelector('.fn-page');
      if (pg && !pg.querySelector(':scope > .fn-offline')) pg.prepend(offlineBadge(at));
      if (staleBtn) staleBtn.title = `Refresh · FarmNet did not answer: last update ${when(at)}`;
      later(opts.every || RETRY);
      return;
    }
    toast(`FarmNet: ${e.message}`, 'bad');
    if (shownStale && staleBtn) staleBtn.title = 'Refresh · FarmNet did not answer: this is the last reading';
    if (opts.quiet && opts.every) later(opts.every);
  };
  // nothing on screen and nothing kept: say so, and when FarmNet is only out of reach, try again by itself
  const nothing = e => {
    mount.textContent = '';
    if (!unreached(e)) { mount.append(el('div', 'note bad', e.message)); return; }
    const n = offlineBadge(null); n.classList.add('fn-offline-alone');
    mount.append(n);
    later(RETRY);
  };
  let h;
  try { h = await hello; } catch (e) {
    if (my !== token) return;
    if (onScreen) { failedAsk(e); return; }
    nothing(e); return;
  }
  if (my !== token) return;
  if (!h?.connected) {
    mount.textContent = '';
    mount.append(pageHead(null, 'FarmNet\'s own controller, live: irrigation, mixing, climate, sensors and alarms.'),
      el('div', 'note', `${farm.name} has no FarmNet controller set up on the platform. The controller's address, device number and key are kept as secrets of the function farmnet (FARMNET_${(farm.code || '').toUpperCase()}_URL, _DEVICE, _KEY); the owner sets them.`));
    return;
  }
  const ctx = {
    farm, may: !!h.may_control, actions: h.actions || {}, fresh: !opts.quiet,
    live: () => mount.isConnected && my === token,
    // after a command: in place, no "Asking…"; even if a minute's re-read started meanwhile (it may have read FarmNet before the command)
    redraw: () => { if (mount.isConnected) again(true); },
  };
  const body = el('div', 'fn-page');
  let failed = null;
  fellBack = Infinity;                        // the reads below that FarmNet did not answer, drawn from what was kept
  try { await draw(ctx, body); } catch (e) { failed = e; }
  // an older page that ended meanwhile returns first: it must not take or wipe what the newer one's reads recorded
  if (!ctx.live()) return;
  const fb = fellBack; fellBack = Infinity;
  if (failed) {
    if (onScreen) { failedAsk(failed); return; }   // what is on screen is better than an error
    if (unreached(failed)) { nothing(failed); return; }
    body.replaceChildren(el('div', 'note bad', failed.message));
  }
  const offline = Number.isFinite(fb);
  if (offline) body.prepend(offlineBadge(fb));
  mount.dataset.fnAt = String(offline ? fb : Date.now());
  const refresh = refreshButton(() => again(false), offline
    ? `Refresh · FarmNet did not answer: last update ${when(fb)} · asked again by itself`
    : `Refresh · read ${farmLocal(new Date().toISOString()).slice(11)}${opts.every ? ' · again every minute' : ''}`);
  mount.replaceChildren(headOf(opts.commands && !ctx.may ? READ_ONLY : null, refresh), body);
  // the Overview reads again by itself while it is on screen; any page does while FarmNet is out of reach
  if (opts.every || offline) later(opts.every || RETRY);
}

// ── small pieces ────────────────────────────────────────────────────────────
export function card(title, ...right) {
  const c = el('div', 'card card-pad fc-card');
  const head = el('div', 'fc-head');
  head.append(el('h3', null, title));
  if (right.length) head.append(el('div', 'spacer'), ...right);
  c.append(head);
  return c;
}
export const bad = e => el('div', 'note bad', e);
export const link = (href, text) => { const a = el('a', 'btn btn-sm btn-ghost', text); a.href = href; return a; };

function vals(list) {
  const row = el('div', 'cx-vals');
  (list || []).forEach(d => {
    const v = el('div', 'cx-val');
    const s = show(d.V);
    v.append(el('span', 'cx-v', s), el('span', 'cx-u', s === '—' ? '' : (d.U || '')), el('span', 'cx-l', d.N || ''));
    row.append(v);
  });
  return row;
}

export function unit(title, run, list, buttons, extra) {
  const u = el('div', 'fc-unit');
  const head = el('div', 'fc-unit-head');
  head.append(el('b', null, title));
  if (run !== undefined) head.append(el('span', 'pill ' + (run ? 'ok' : ''), run ? 'Running' : 'Idle'));
  u.append(head);
  if (extra) u.append(el('div', 'hint fc-next', extra));
  u.append(vals(list));
  if (buttons?.length) { const b = el('div', 'fc-btns'); b.append(...buttons); u.append(b); }
  return u;
}
export const nextOf = x => x?.next && x.next !== '----' ? `next start ${short(x.next)}` : '';

// one press at a time: the button stays off until its drawer or command is done (a double click sent two commands)
export function btn(label, onclick, cls = 'btn btn-sm') {
  const b = el('button', cls, label); b.type = 'button';
  b.onclick = async () => { if (b.disabled) return; b.disabled = true; try { await onclick(b); } finally { b.disabled = false; } };
  return b;
}

export function table(heads, rows, numeric = []) {
  const w = el('div', 'table-wrap fc-table');
  const t = el('table'); const th = el('thead'); const tr = el('tr');
  heads.forEach((h, i) => tr.append(el('th', numeric.includes(i) ? 'num' : null, h))); th.append(tr);
  const tb = el('tbody');
  if (!rows.length) { const r = el('tr'); const td = el('td', 'hint', 'Nothing.'); td.colSpan = heads.length; r.append(td); tb.append(r); }
  rows.forEach(cells => {
    const r = el('tr');
    cells.forEach((x, i) => {
      if (x instanceof Node) { const td = el('td', numeric.includes(i) ? 'num' : null); td.append(x); r.append(td); }
      else r.append(el('td', numeric.includes(i) ? 'num' : null, x == null || x === '' ? '—' : String(x)));
    });
    tb.append(r);
  });
  t.append(th, tb); w.append(t);
  return w;
}

// a span of days chosen with a segmented control, kept on this computer
export function spanPicker(key, spans, onPick) {
  const cur = Number(pref.get(key) ?? spans[0][0]);
  const at = spans.some(s => s[0] === cur) ? cur : spans[0][0];
  const seg = el('div', 'seg');
  spans.forEach(([n, label]) => {
    const b = el('button', 'seg-btn', label); b.type = 'button'; b.setAttribute('aria-pressed', String(n === at));
    b.onclick = () => { if (n === at) return; pref.set(key, String(n)); onPick(); };
    seg.append(b);
  });
  return { at, seg };
}
export const DAY_SPANS = [[0, 'Today'], [1, '2 days'], [6, '7 days']];
export const range = back => { const day = farmDate(); return { start: ymd(addDays(day, -back)), stop: ymd(day) }; };

// the centres and their full status (detail: the valve, the mixers, the disinfection, the tanks)
export async function centres(farm) {
  const cs = await ask(farm, 'centres') || [];
  const det = await Promise.all(cs.map(c => soft(ask(farm, 'irrigation_detail', { id: c.id }))));
  return cs.map((c, i) => ({ ...c, status: det[i] }));
}
