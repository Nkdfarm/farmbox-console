// FarmNet pages: the shared frame (ask/send, readings helpers, kept answers, pins, page, card, table, centres)
import { fn } from '../api.js';
import { el, pageHead, toast, loading, farmDate, farmLocal, pref, addDays, ymd } from '../ui.js';

const FN = 'farmnet';
export const ask = (farm, action, args = {}) => fn(FN, { farm: farm.id, action, args }, { quiet: true }).then(r => r?.data);
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
  const k = farm.id + '|' + key, m = memo.get(k);
  if (m && Date.now() - m.at < ms) return m.p;
  const p = load();
  memo.set(k, { at: Date.now(), p });
  p.catch(() => memo.delete(k));            // a failure is not kept
  return p;
}
const helloOf = farm => kept(farm, 'hello', 5 * 60000, () => fn(FN, { farm: farm.id, action: 'hello' }, { quiet: true }));

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
const MAY = 'Commands go straight to the greenhouse: each one asks you to confirm and is logged (Commands).';
const READ_ONLY = 'Read only: the farm admin and the farm manager may send commands.';

export async function page(mount, farm, blurb, draw, opts = {}) {
  const my = ++token;
  if (!opts.quiet) { mount.textContent = ''; mount.append(loading('Asking FarmNet…')); }
  const again = q => page(mount, farm, blurb, draw, { ...opts, quiet: q });
  let h;
  try { h = await helloOf(farm); } catch (e) {
    if (my !== token) return;
    // a quiet re-read that fails keeps what is on screen and tries again at the next minute
    if (opts.quiet && mount.querySelector('.fn-page')) {
      toast(`FarmNet: ${e.message}`, 'bad');
      if (opts.every) setTimeout(() => { if (mount.isConnected && my === token) again(true); }, opts.every);
      return;
    }
    mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return;
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
  try { await draw(ctx, body); } catch (e) { body.replaceChildren(el('div', 'note bad', e.message)); }
  if (!ctx.live()) return;
  const refresh = el('button', 'btn btn-sm', 'Refresh'); refresh.type = 'button';
  refresh.onclick = () => again(false);
  const stamp = el('span', 'hint', `read ${farmLocal(new Date().toISOString()).slice(11)}${opts.every ? ' · again every minute' : ''}`);
  mount.replaceChildren(pageHead(null, opts.commands ? `${blurb} ${ctx.may ? MAY : READ_ONLY}` : blurb, stamp, refresh), body);
  // the Overview reads again by itself while it is on screen (not while the window is hidden, not while a drawer is open)
  if (opts.every) {
    const tick = () => {
      if (!ctx.live()) return;
      if (document.visibilityState !== 'visible' || document.querySelector('aside.drawer')) { setTimeout(tick, 15000); return; }
      again(true);
    };
    setTimeout(tick, opts.every);
  }
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
