// ═══════════════════════════════════════════════════════════════════════════
// Task families and sub-families (migration 0060, console 0.7.55)
//
// One list — Agriculture · Maintenance · Office and their sub-families — read
// at sign-in and used by People › Responsible for, the procedure editor and the
// labels. Edited in Settings › Task families (franchisor only), in its own
// window because it changes a few times a year. Renaming a sub-family renames
// it on the procedures and the people that carry it, in the same save.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, input, toast, drawer, busy, subFamilyTag } from './ui.js';

let LIST = { may_edit: false, families: [
  { name: 'Agriculture', active: true, subfamilies: [] },
  { name: 'Maintenance', active: true, subfamilies: [] },
  { name: 'Office', active: true, subfamilies: [] },
] };

export async function loadFamilies() {
  try { LIST = await rpc('task_families', {}); } catch { /* the built-in three stand in */ }
  return LIST;
}
export const familyList = () => LIST;
// [value, label] pairs for a family menu (active ones, plus `keep` if it is off)
export const familyOptions = (keep) => LIST.families
  .filter(f => f.active || f.name === keep).map(f => [f.name, f.name]);
// the sub-family names of one family (active ones, plus `keep`)
export const subFamiliesOf = (family, keep) => (LIST.families.find(f => f.name === family)?.subfamilies || [])
  .filter(s => s.active || s.name === keep).map(s => s.name);

// ── Settings › Task families: one line, and the list in its own window ─────
export function familiesRow() {
  const r = el('div', 'set-row');
  const t = el('div', 'set-text');
  const sum = el('small', null, 'Reading…');
  t.append(el('b', null, 'Families and sub-families'), sum);
  const open = el('button', 'btn btn-sm', 'Open');
  open.onclick = () => openFamilies(() => paint());
  r.append(t, open);
  const paint = () => {
    const f = LIST.families.filter(x => x.active);
    const n = f.reduce((a, x) => a + (x.subfamilies || []).filter(s => s.active).length, 0);
    sum.textContent = `${f.length} families · ${n} sub-families — what procedures, tasks and People are sorted by.`;
  };
  loadFamilies().then(paint);
  return r;
}

function openFamilies(onChange) {
  const d = drawer('Families and sub-families',
    'What procedures and tasks are sorted by, and what each person is responsible for.');
  d.box.style.width = 'min(720px, 100vw)';
  const paint = () => {
    d.body.textContent = '';
    LIST.families.forEach(f => {
      const c = el('div', 'card card-pad');
      c.style.marginBottom = 'var(--space-3)';
      const h = el('div', 'row');
      h.append(el('b', null, f.name), el('span', 'hint', `${f.procedures ?? 0} procedures`));
      if (!f.active) h.append(el('span', 'pill warn', 'off'));
      c.append(h);
      const chips = el('div', 'chips');
      chips.style.marginTop = 'var(--space-2)';
      (f.subfamilies || []).forEach(s => {
        const t = subFamilyTag(s.name, 'chip');
        t.title = `${s.procedures ?? 0} procedures · ${s.people ?? 0} people` + (s.active ? '' : ' · off');
        if (!s.active) t.style.opacity = '0.45';
        chips.append(t);
      });
      if (!(f.subfamilies || []).length) chips.append(el('span', 'hint', 'No sub-families.'));
      c.append(chips);
      d.body.append(c);
    });
    d.footer.textContent = '';
    const close = el('button', 'btn', 'Close');
    close.onclick = d.close;
    d.footer.append(close);
    if (LIST.may_edit) {
      const e = el('button', 'btn btn-primary', 'Edit');
      e.onclick = () => { d.close(); editFamilies(async () => { await loadFamilies(); onChange?.(); openFamilies(onChange); }); };
      d.footer.append(e);
    } else {
      d.footer.prepend(el('span', 'hint', 'Only the franchisor edits this list.'));
    }
  };
  paint();
}

function editFamilies(onSaved) {
  const d = drawer('Edit families and sub-families',
    'Renaming a sub-family renames it on the procedures and people that use it. Switch one off instead of deleting it.');
  d.box.style.width = 'min(760px, 100vw)';
  const fams = LIST.families.map(f => ({
    name: f.name, old_name: f.name, sort: f.sort, active: f.active,
    subfamilies: (f.subfamilies || []).map(s => ({ name: s.name, old_name: s.name, sort: s.sort,
                                                   active: s.active, uses: (s.procedures || 0) + (s.people || 0) })),
  }));
  const box = el('div');
  const onOff = (x, repaint) => {
    const b = el('button', 'toggle', x.active ? 'On' : 'Off');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!x.active));
    b.onclick = () => { x.active = !x.active; repaint(); };
    return b;
  };
  const paint = () => {
    box.textContent = '';
    fams.forEach(f => {
      const c = el('div', 'card card-pad');
      c.style.marginBottom = 'var(--space-3)';
      const h = el('div', 'row');
      h.style.flexWrap = 'nowrap';
      const fn = input({ value: f.name, placeholder: 'Family' });
      fn.style.flex = '1';
      fn.style.fontWeight = '600';
      fn.oninput = () => { f.name = fn.value; };
      h.append(fn, onOff(f, paint));
      c.append(h);
      f.subfamilies.forEach((s, i) => {
        const line = el('div', 'row');
        line.style.flexWrap = 'nowrap';
        line.style.margin = 'var(--space-2) 0 0 var(--space-5)';
        const sn = input({ value: s.name, placeholder: 'Sub-family' });
        sn.style.flex = '1';
        sn.oninput = () => { s.name = sn.value; };
        const uses = el('span', 'hint', s.uses ? `used ${s.uses}×` : '');
        uses.style.minWidth = '64px';
        line.append(sn, uses, onOff(s, paint));
        if (!s.old_name) {
          const x = el('button', 'btn btn-sm', '✕');
          x.title = 'Not saved yet — drop it';
          x.onclick = () => { f.subfamilies.splice(i, 1); paint(); };
          line.append(x);
        }
        c.append(line);
      });
      const add = el('button', 'btn btn-sm', '+ Sub-family');
      add.style.margin = 'var(--space-2) 0 0 var(--space-5)';
      add.onclick = () => {
        f.subfamilies.push({ name: '', old_name: null, sort: (f.subfamilies.length + 1) * 10, active: true });
        paint();
        c.querySelectorAll('input')[f.subfamilies.length]?.focus();
      };
      c.append(add);
      box.append(c);
    });
  };
  const addFam = el('button', 'btn btn-sm', '+ Family');
  addFam.onclick = () => { fams.push({ name: '', old_name: null, sort: (fams.length + 1) * 10, active: true, subfamilies: [] }); paint(); };
  d.body.append(box, addFam);
  paint();

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save');
  save.onclick = async () => {
    const trim = v => String(v || '').trim();
    if (fams.some(f => !trim(f.name) || f.subfamilies.some(s => !trim(s.name)))) {
      toast('Every family and sub-family needs a name', 'bad'); return;
    }
    const dupF = fams.map(f => trim(f.name).toLowerCase()).find((n, i, a) => a.indexOf(n) !== i);
    if (dupF) { toast(`Two families are called "${dupF}"`, 'bad'); return; }
    for (const f of fams) {
      const dup = f.subfamilies.map(s => trim(s.name).toLowerCase()).find((n, i, a) => a.indexOf(n) !== i);
      if (dup) { toast(`${trim(f.name)} has "${dup}" twice`, 'bad'); return; }
    }
    busy(save, true, 'Saving…');
    try {
      await rpc('save_task_families', { p: { families: fams.map(f => ({
        name: trim(f.name), old_name: f.old_name, sort: f.sort ?? 100, active: !!f.active,
        subfamilies: f.subfamilies.map(s => ({ name: trim(s.name), old_name: s.old_name,
                                               sort: s.sort ?? 100, active: !!s.active })),
      })) } });
      toast('Families saved', 'ok');
      d.close();
      await onSaved?.();
    } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
