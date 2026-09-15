// The three things every page needs: build an element, say something, ask
// something. Deliberately small — the console has no component framework and
// does not need one.

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function frag(...kids) {
  const f = document.createDocumentFragment();
  kids.filter(Boolean).forEach(k => f.append(k));
  return f;
}

export function field(label, input, hint) {
  const w = el('div', 'field');
  const l = el('label', null, label);
  if (input.id) l.htmlFor = input.id;
  w.append(l, input);
  if (hint) w.append(el('div', 'hint', hint));
  return w;
}

export function input(attrs = {}) {
  const i = el('input');
  Object.entries(attrs).forEach(([k, v]) => { if (v != null) i[k] = v; });
  return i;
}

export function selectBox(options, value) {
  const s = el('select');
  options.forEach(([v, label]) => {
    const o = el('option', null, label);
    o.value = v;
    s.append(o);
  });
  if (value != null) s.value = value;
  return s;
}

let toastTimer;
export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast ' + kind, message);
  t.setAttribute('role', 'status');
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}

// A right-hand drawer. Returns { body, footer, close } — the caller fills the
// body, adds buttons to the footer, and closes when it is done.
export function drawer(title, subtitle, opts = {}) {
  const scrim = el('div', 'scrim');
  const box = el('aside', 'drawer');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);

  const head = el('header');
  const titles = el('div');
  titles.append(el('h2', null, title));
  if (subtitle) titles.append(el('div', 'hint', subtitle));
  const x = el('button', 'btn btn-ghost btn-sm', '✕');
  x.setAttribute('aria-label', 'Close');
  head.append(titles, el('div', 'spacer'), x);

  const body = el('div', 'body');
  const footer = el('footer');
  box.append(head, body, footer);
  document.body.append(scrim, box);

  const close = () => {
    scrim.remove(); box.remove();
    opts.onClose?.();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close;
  x.onclick = close;
  setTimeout(() => box.querySelector('input, select, button')?.focus(), 30);

  return { box, body, footer, close };
}

export function confirmDrawer(title, message, okLabel, danger) {
  return new Promise(resolve => {
    const d = drawer(title);
    d.body.append(el('p', null, message));
    const no = el('button', 'btn', 'Cancel');
    const yes = el('button', 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), okLabel);
    no.onclick = () => { d.close(); resolve(false); };
    yes.onclick = () => { d.close(); resolve(true); };
    d.footer.append(no, yes);
  });
}

export const initials = name =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('') || '?';

// Readable, typable, and long enough for the 10-character floor. No l/1/O/0.
export function suggestPassword() {
  const words = ['basil', 'kale', 'rocket', 'chard', 'mint', 'thyme', 'sage',
                 'pepper', 'tomato', 'sorrel', 'cress', 'fennel'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = String(Math.floor(Math.random() * 9000) + 1000);
  return w[0].toUpperCase() + w.slice(1) + '-' + n + '-farm';
}

export function busy(button, on, label) {
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = '';
    button.append(el('span', 'spin'), document.createTextNode(' ' + (label || 'Working…')));
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || label || 'Save';
  }
}

// A table, because six of the console's screens are one. Columns are
// { key, label, align, fmt, title } — fmt gets (value, row) and may return a
// node or a string. Anything wide scrolls inside its own box rather than
// pushing the page sideways.
export function table(columns, rows, opts = {}) {
  const wrap = el('div', 'table-wrap');
  const t = el('table');
  const thead = el('thead');
  const htr = el('tr');
  columns.forEach(c => {
    const th = el('th', c.align === 'right' ? 'right' : null, c.label);
    htr.append(th);
  });
  thead.append(htr);
  t.append(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    if (opts.rowClass) tr.className = opts.rowClass(r) || '';
    columns.forEach(c => {
      const td = el('td', c.align === 'right' ? 'right' : null);
      const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
      if (v instanceof Node) td.append(v);
      else td.textContent = v == null || v === '' ? '—' : String(v);
      if (c.title) td.title = c.title(r) || '';
      tr.append(td);
    });
    if (opts.onRow) { tr.style.cursor = 'pointer'; tr.onclick = () => opts.onRow(r); }
    tb.append(tr);
  });
  t.append(tb);
  wrap.append(t);
  if (!rows.length) {
    wrap.textContent = '';
    wrap.append(el('div', 'empty', opts.empty || 'Nothing here yet.'));
  }
  return wrap;
}

// Head of a page: title, one sentence saying what it is for, and whatever
// buttons belong to the whole screen.
export function pageHead(title, blurb, ...right) {
  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, title));
  if (blurb) titles.append(el('p', null, blurb));
  head.append(titles, el('div', 'spacer'));
  right.filter(Boolean).forEach(n => head.append(n));
  return head;
}

export function card(title, ...kids) {
  const c = el('div', 'card');
  c.style.marginBottom = 'var(--space-4)';
  if (title) {
    const h = el('div', 'card-pad row');
    h.append(el('div', 'sec-title', title));
    h.append(el('div', 'spacer'));
    c.append(h);
    c._head = h;
  }
  kids.filter(Boolean).forEach(k => c.append(k));
  return c;
}

// ── dates, in local parts ───────────────────────────────────────────────
// Never through Date(string) alone and never back out through toISOString:
// that converts to UTC, and in Johannesburg it lands a page on the day before.
export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const isoDow = d => ((d.getDay() + 6) % 7) + 1;           // Mon = 1 … Sun = 7
export const mondayOf = d => addDays(d, 1 - isoDow(d));

// ── this device's preferences ───────────────────────────────────────────
// localStorage can be absent or throw (a private window, blocked site data);
// a preference then lasts for the visit and nothing breaks.
export const pref = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }
    catch { /* private window */ }
  },
};

export const num = (v, dp = 0) =>
  v == null ? '—' : Number(v).toLocaleString(undefined,
    { minimumFractionDigits: dp, maximumFractionDigits: dp });

// A local date, printed short. Never through toISOString.
export function shortDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short' });
}

// ── icons ──────────────────────────────────────────────────────────────────
// One line-icon set on a 24 grid with a round 1.75 stroke, so the rail, the
// tiles and the buttons speak the same language. Everything is currentColor:
// the stylesheet decides the colour, never the icon.
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  farm: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11"/><circle cx="16" cy="6" r="2.25"/><circle cx="10" cy="12" r="2.25"/><circle cx="18" cy="18" r="2.25"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7Z"/><path d="M12 10c0-3.5 2.5-6 7-6 0 3.5-2.5 6-7 6Z"/>',
  basket: '<path d="M3 10h18l-1.8 8.4A2 2 0 0 1 17.2 20H6.8a2 2 0 0 1-2-1.6Z"/><path d="m8 10 3-6M16 10l-3-6"/><path d="M9 14v2.5M12 14v2.5M15 14v2.5"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13"/><path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V4"/><path d="m9 13 2 2 4-4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.6l2.5 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.9-1.5L21.5 7H6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.3a3.5 3.5 0 0 1 0 7.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudSun: '<path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41"/><path d="M15.95 12.65a4 4 0 0 0-5.93-4.13"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloudRain: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  cloudSnow: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  cloudFog: '<path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="M16 17H7M17 21H9"/>',
  cloudLightning: '<path d="M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97"/><path d="m13 12-3 5h4l-3 5"/>',
  pin: '<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.6a10 10 0 0 1 5.2-2.8"/><path d="M2 8.8a15 15 0 0 1 4.2-2.7"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M16.9 10.6a10 10 0 0 1 2.1 2"/><path d="M12 20h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  chevronLeft: '<path d="m14.5 17-5-5 5-5"/>',
  chevronRight: '<path d="m9.5 7 5 5-5 5"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.75');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ── faces ──────────────────────────────────────────────────────────────────
// Demo portraits until people have photos of their own: men, Black and brown,
// hand-picked from randomuser.me's set so the demo looks like the people who
// work in a FarmBox. The face is picked by a hash of the person's id, so
// somebody keeps the same one on every page and every reload. A real
// photo_url, when there is one, always wins; with no signal the initials stay
// where the photo would have been.
const FACES = [5, 12, 16, 25, 30, 38, 39, 48, 49, 50, 53, 54, 55, 56, 58, 59,
               65, 69, 80, 83, 91, 95];
const hash = s => {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
export const demoFace = key => {
  const h = hash(key);
  return `https://randomuser.me/api/portraits/men/${FACES[h % FACES.length]}.jpg`;
};

// p is anything with a name and an id: { worker_id | id, name, role?, photo_url? }.
// The worker id is the key wherever there is one, so a person has the same
// face on People, on the plan and in the rail; app.js looks the signed-in
// person's worker row up for that reason. size is '', 'sm' or 'lg'.
export function avatar(p, size = '') {
  const cls = ['avatar', size, p.role && 'r-' + p.role].filter(Boolean).join(' ');
  const box = el('div', cls, initials(p.name));
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => { box.textContent = ''; box.append(img); box.classList.add('has-photo'); };
  img.src = p.photo_url || demoFace(p.worker_id ?? p.id ?? p.name);
  return box;
}
