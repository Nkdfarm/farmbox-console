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
export function drawer(title, subtitle) {
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
