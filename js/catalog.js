// ═══════════════════════════════════════════════════════════════════════════
// Farm setup › Available systems and media (migration 0057, console 0.7.49)
//
// The list every picker in the console offers: the growing systems (NFT, NGS,
// Drip-irrigated substrate, …) with the media each takes by default, and the
// growing media (Net cup, Pots, …, Bucket). The Crop database reads it to say
// which systems a crop can grow on. Standard data: the franchisor edits it,
// everyone reads it. Codes are ids and never change once saved; an entry is
// switched off rather than deleted, so a zone or crop that uses it keeps it.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, field, input, toast, drawer, busy, catalog, setCatalog } from './ui.js';

// the list as the server has it (with in_use counts), read once per page view
let full = null;

async function read() {
  full = await rpc('system_catalog', {});
  setCatalog(full);
  return full;
}

export function catalogCard(repaint) {
  const card = el('div', 'card');
  card.style.marginTop = 'var(--space-4)';
  const head = el('div', 'row');
  head.style.padding = 'var(--space-3) var(--space-4)';
  head.style.borderBottom = '1px solid var(--border)';
  head.append(el('b', null, 'Available systems and media'));
  head.append(el('span', 'hint', 'What every zone, crop and procedure picks from.'));
  head.append(el('div', 'spacer'));
  card.append(head);
  const body = el('div');
  body.style.padding = 'var(--space-3) var(--space-4)';
  body.append(el('div', 'hint', 'Reading the list…'));
  card.append(body);

  const paint = c => {
    body.textContent = '';
    const mediaName = code => c.media.find(m => m.code === code)?.label ?? code;

    body.append(el('div', 'sec-title', 'Systems'));
    body.append(table(['System', 'Code', 'Default media', 'Zones', ''], c.systems.map(s => [
      el('b', null, s.label),
      el('span', 'mono', s.code),
      el('span', null, (s.default_media || []).map(mediaName).join(', ') || '—'),
      el('span', 'mono', String(s.in_use || 0)),
      s.active ? el('span', 'pill ok', 'on') : el('span', 'pill warn', 'off'),
    ]), c.systems.map(s => s.description)));

    const t = el('div', 'sec-title', 'Media');
    t.style.marginTop = 'var(--space-4)';
    body.append(t);
    body.append(table(['Medium', 'Code', 'Used by', ''], c.media.map(m => [
      el('b', null, m.label),
      el('span', 'mono', m.code),
      el('span', 'mono', String(m.in_use || 0)),
      m.active ? el('span', 'pill ok', 'on') : el('span', 'pill warn', 'off'),
    ]), c.media.map(m => m.description)));

    if (c.may_edit) {
      const b = el('button', 'btn btn-sm', 'Edit');
      b.onclick = () => edit(c, async () => { paint(await read()); repaint?.(); });
      head.append(b);
    } else {
      body.append(el('div', 'hint', 'Only the franchisor edits this list.'));
    }
  };

  read().then(paint).catch(e => {
    body.textContent = '';
    body.append(el('div', 'note bad', e.message));
  });
  return card;
}

function table(headers, rows, titles = []) {
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people');
  const th = el('thead'), hr = el('tr');
  headers.forEach(h => hr.append(el('th', null, h)));
  th.append(hr); t.append(th);
  const tb = el('tbody');
  rows.forEach((cells, i) => {
    const tr = el('tr');
    if (titles[i]) tr.title = titles[i];
    cells.forEach(x => { const d = el('td'); d.append(x); tr.append(d); });
    tb.append(tr);
  });
  t.append(tb); wrap.append(t);
  return wrap;
}

// ── edit ───────────────────────────────────────────────────────────────────
const toCode = s => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  .replace(/^(\d)/, 'x$1');

function edit(c, onSaved) {
  const d = drawer('Available systems and media',
    'Names and descriptions can change any time; a code is fixed once saved. Switch an entry off instead of deleting it.');
  d.box.style.width = 'min(820px, 100vw)';

  const media = c.media.map(m => ({ ...m, saved: true }));
  const systems = c.systems.map(s => ({ ...s, default_media: [...(s.default_media || [])], saved: true }));

  const mediaBox = el('div');
  const sysBox = el('div');

  const onOff = (row, repaint) => {
    const b = el('button', 'toggle', row.active ? 'On' : 'Off');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!row.active));
    b.title = row.in_use ? `Used ${row.in_use}× — switching it off only hides it from new choices` : '';
    b.onclick = () => { row.active = !row.active; repaint(); };
    return b;
  };

  const codeInput = row => {
    const code = input({ value: row.code || '', placeholder: 'code' });
    code.className = 'mono';
    code.style.width = '150px';
    code.disabled = row.saved;
    code.title = row.saved ? 'A saved code is fixed: zones, crops and procedures refer to it.' : 'Lower-case, digits and _';
    code.oninput = () => { row.code = code.value; row.codeTouched = true; };
    return code;
  };

  const paintMedia = () => {
    mediaBox.textContent = '';
    media.forEach(m => {
      const line = el('div', 'row');
      line.style.margin = '0 0 var(--space-2)';
      line.style.flexWrap = 'nowrap';
      const label = input({ value: m.label || '', placeholder: 'Name, e.g. Grow bag' });
      label.style.flex = '1';
      const code = codeInput(m);
      label.oninput = () => {
        m.label = label.value;
        if (!m.saved && !m.codeTouched) { m.code = toCode(label.value); code.value = m.code; }
      };
      // a new or renamed medium shows up in the systems' default-media choices
      label.onchange = () => paintSystems();
      const desc = input({ value: m.description || '', placeholder: 'What it is (optional)' });
      desc.style.flex = '2';
      desc.oninput = () => { m.description = desc.value; };
      line.append(label, code, desc, onOff(m, paintMedia));
      if (!m.saved) {
        const x = el('button', 'btn btn-sm', '✕');
        x.title = 'Not saved yet — drop it';
        x.onclick = () => { media.splice(media.indexOf(m), 1); paintMedia(); paintSystems(); };
        line.append(x);
      }
      mediaBox.append(line);
    });
  };

  const paintSystems = () => {
    sysBox.textContent = '';
    systems.forEach(s => {
      const card = el('div', 'card card-pad');
      card.style.marginBottom = 'var(--space-3)';
      const line = el('div', 'row');
      line.style.flexWrap = 'nowrap';
      const label = input({ value: s.label || '', placeholder: 'Name, e.g. Aeroponics' });
      label.style.flex = '1';
      const code = codeInput(s);
      label.oninput = () => {
        s.label = label.value;
        if (!s.saved && !s.codeTouched) { s.code = toCode(label.value); code.value = s.code; }
      };
      line.append(label, code, onOff(s, paintSystems));
      if (!s.saved) {
        const x = el('button', 'btn btn-sm', '✕');
        x.onclick = () => { systems.splice(systems.indexOf(s), 1); paintSystems(); };
        line.append(x);
      }
      card.append(line);

      const desc = input({ value: s.description || '', placeholder: 'How it works (optional)' });
      desc.style.width = '100%';
      desc.style.marginTop = 'var(--space-2)';
      desc.oninput = () => { s.description = desc.value; };
      card.append(desc);

      // default media: what a new zone of this system starts with
      const on = new Set(s.default_media);
      const chips = el('div', 'row');
      chips.style.flexWrap = 'wrap';
      chips.style.marginTop = 'var(--space-2)';
      chips.append(el('span', 'hint', 'Default media:'));
      media.filter(m => m.code && (m.active || on.has(m.code))).forEach(m => {
        const b = el('button', 'toggle', m.label || m.code);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(on.has(m.code)));
        b.onclick = () => {
          if (on.has(m.code)) on.delete(m.code); else on.add(m.code);
          s.default_media = [...on];
          b.setAttribute('aria-pressed', String(on.has(m.code)));
        };
        chips.append(b);
      });
      card.append(chips);
      sysBox.append(card);
    });
  };

  const addRow = (label, onClick) => {
    const r = el('div', 'row');
    r.style.margin = 'var(--space-2) 0 var(--space-4)';
    const b = el('button', 'btn btn-sm', label);
    b.onclick = onClick;
    r.append(b);
    return r;
  };

  d.body.append(el('div', 'sec-title', 'Media'), mediaBox,
    addRow('+ Add medium', () => {
      media.push({ code: '', label: '', active: true, saved: false, sort: (media.length + 1) * 10 });
      paintMedia();
      mediaBox.lastElementChild?.querySelector('input')?.focus();
    }));
  d.body.append(el('div', 'sec-title', 'Systems'), sysBox,
    addRow('+ Add system', () => {
      systems.push({ code: '', label: '', default_media: [], active: true, saved: false,
                     sort: (systems.length + 1) * 10 });
      paintSystems();
      sysBox.lastElementChild?.querySelector('input')?.focus();
    }));
  paintMedia();
  paintSystems();

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save the list');
  save.onclick = async () => {
    const bad = [...media, ...systems].find(x => !String(x.label || '').trim() || !/^[a-z][a-z0-9_]*$/.test(x.code || ''));
    if (bad) {
      toast(`"${bad.label || bad.code || 'new entry'}" needs a name and a code (lower-case letters, digits, _)`, 'bad');
      return;
    }
    const codes = arr => arr.map(x => x.code);
    const dup = a => a.find((c, i) => a.indexOf(c) !== i);
    const d1 = dup(codes(media)), d2 = dup(codes(systems));
    if (d1 || d2) { toast(`The code "${d1 || d2}" is used twice`, 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      const pick = (x, extra = {}) => ({ code: x.code, label: x.label.trim(), description: x.description || '',
                                        active: !!x.active, sort: x.sort ?? 100, ...extra });
      await rpc('save_system_catalog', { p: {
        media: media.map(m => pick(m)),
        systems: systems.map(s => pick(s, { default_media: s.default_media || [] })),
      } });
      toast('Available systems and media saved', 'ok');
      d.close();
      await onSaved?.();
    } catch (e) { busy(save, false, 'Save the list'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

// used at sign-in so every page has the list before it draws
export async function loadCatalog() {
  try { await read(); } catch { /* the built-in copy in ui.js stands in */ }
  return catalog();
}
