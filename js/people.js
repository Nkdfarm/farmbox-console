// ═══════════════════════════════════════════════════════════════════════════
// Labour › People — the people of one FarmBox (spec §7.x)
//
// One page for what used to be three trips through the Supabase dashboard: the
// account they sign in with, the access it carries, and the work they are
// responsible for. Adding someone is one form; the weekly plan reads the
// responsibilities set at the bottom of it.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, select } from './api.js';
import { el, field, input, selectBox, toast, drawer, confirmDrawer,
         avatar, suggestPassword, busy, setPhotos, subFamilyTag } from './ui.js';

// The words on screen are the job, not the database value.
export const ROLES = [
  ['farm_admin', 'Admin', 'Runs this FarmBox: settings, people, plans, procedures.'],
  ['farm_manager', 'Farm manager', 'Runs the week: builds and validates the labour plan.'],
  ['farm_assistant', 'Farm assistant', 'Runs tasks and can plan a day. Cannot sign off the week.'],
  ['agronomist', 'Agronomist', 'Owns the crops: plans and validates the crop plan, edits this farm’s own crops, runs IPM. Cannot sign off the week.'],
  ['worker', 'Worker', 'Does the work: My Week, checklists, evidence.'],
  ['technician', 'Technician', 'Maintenance and repairs.'],
  ['office', 'Office', 'Purchasing, records, reporting.'],
];
export const roleLabel = v => ROLES.find(r => r[0] === v)?.[1] ?? v;

// How somebody is employed, beside what they do (migration 0091). "On demand" is
// stored as casual: out of the week's capacity, called in only when needed.
export const EMPLOYMENT = [
  ['permanent', 'Permanent', 'In the week’s capacity. The planner gives them work freely.'],
  ['part_time', 'Part time', 'Planned like permanent, on the working days and hours set below.'],
  ['casual', 'On demand', 'Not in the week’s capacity. Called in only when nobody permanent can take the work, and the plan says so.'],
];
export const employmentLabel = v => EMPLOYMENT.find(r => r[0] === v)?.[1] ?? 'Permanent';

const WORKER_SLOTS = Array.from({ length: 10 }, (_, i) => `Worker ${i + 1}`);
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

let farm = null;      // { id, name, code }
let people = [];
let tree = [];        // [{ family, category, procedures }]
let mount = null;

export async function renderPeople(container, currentFarm) {
  farm = currentFarm;
  mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Loading the people of ' + farm.name + '…'));
  try {
    [people, tree] = await Promise.all([
      rpc('people', { p_farm: farm.id }),
      rpc('family_tree', { p_farm: farm.id }),
    ]);
  } catch (e) {
    mount.textContent = '';
    mount.append(el('div', 'note bad', e.message));
    return;
  }
  setPhotos(people);   // a picture saved here shows on every page at once
  paint();
}

// ── the families offered by the picker ─────────────────────────────────────
// family_tree returns one row per family/category pair that this farm has
// procedures for. Group it, and keep families with no categories usable.
function families() {
  const out = new Map();
  for (const r of tree) {
    if (!out.has(r.family)) out.set(r.family, { name: r.family, cats: [], procedures: 0 });
    const f = out.get(r.family);
    f.procedures += r.procedures;
    if (r.category) f.cats.push({ name: r.category, procedures: r.procedures });
  }
  return [...out.values()];
}

function paint() {
  mount.textContent = '';

  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, 'People'));
  titles.append(el('p', null,
    `Who works at ${farm.name}, what they may do, and which part of the work is theirs. ` +
    `The Friday labour plan gives each task to whoever is responsible for its family.`));
  const add = el('button', 'btn btn-primary', '＋ Add person');
  add.onclick = () => openPerson(null);
  head.append(titles, el('div', 'spacer'), add);
  mount.append(head);

  mount.append(summary());

  const gaps = coverageGaps();
  if (gaps.size) {
    const total = [...gaps.values()].reduce((a, l) => a + l.length, 0);
    const n = el('div', 'note warn');
    n.append(document.createTextNode(
      `Nobody is responsible for ${total} area${total === 1 ? '' : 's'} — `));
    [...gaps.entries()].forEach(([family, list], i) => {
      if (i) n.append(document.createTextNode('; '));
      n.append(el('b', null, family));
      n.append(document.createTextNode(': ' + list.join(', ')));
    });
    n.append(document.createTextNode('. Those tasks fall to whoever has room in the week.'));
    n.style.marginBottom = 'var(--space-4)';
    mount.append(n);
  }

  const card = el('div', 'card');
  const wrap = el('div', 'table-wrap');
  wrap.append(table());
  card.append(wrap);
  mount.append(card);
}

function summary() {
  const active = people.filter(p => p.active);
  const withLogin = active.filter(p => p.has_login);
  const admins = active.filter(p => p.role === 'farm_admin' || p.role === 'farm_manager');
  const row = el('div', 'row');
  row.style.margin = '0 0 var(--space-4)';
  const pill = (text, kind) => row.append(el('span', 'pill ' + (kind || ''), text));
  pill(`${active.length} active`);
  pill(`${withLogin.length} can sign in`, withLogin.length ? 'ok' : 'warn');
  pill(admins.length ? `${admins.length} can plan the week` : 'nobody can plan the week',
       admins.length ? '' : 'bad');
  if (people.length !== active.length) pill(`${people.length - active.length} inactive`);
  return row;
}

// Every family/category the farm has procedures for, that nobody owns.
function coverageGaps() {
  const owned = new Set();
  for (const p of people) {
    if (!p.active) continue;
    for (const r of p.responsibilities || []) {
      owned.add(r.category ? `${r.family} ${r.category}` : `${r.family} *`);
    }
  }
  const gaps = new Map();   // family -> the categories nobody owns
  for (const f of families()) {
    if (owned.has(`${f.name} *`)) continue;
    if (!f.cats.length) { gaps.set(f.name, ['everything']); continue; }
    const missing = f.cats.filter(c => !owned.has(`${f.name} ${c.name}`)).map(c => c.name);
    if (missing.length) gaps.set(f.name, missing);
  }
  return gaps;
}

function table() {
  const t = el('table', 'people');
  const thead = el('thead');
  const hr = el('tr');
  ['Person', 'Role', 'Employment', 'Account', 'Responsible for', 'Week', ''].forEach(h => {
    const th = el('th', null, h);
    if (h === '') th.style.width = '1%';
    hr.append(th);
  });
  thead.append(hr);
  t.append(thead);

  const tb = el('tbody');
  if (!people.length) {
    const tr = el('tr');
    const td = el('td');
    td.colSpan = 7;
    const e = el('div', 'empty');
    e.append(el('h3', null, 'Nobody here yet'));
    e.append(el('p', null, 'Add the manager first, then the workers who run the week.'));
    td.append(e);
    tr.append(td);
    tb.append(tr);
  }
  people.forEach(p => tb.append(personRow(p)));
  t.append(tb);
  return t;
}

function personRow(p) {
  const tr = el('tr');
  if (!p.active) tr.className = 'off';

  const who = el('div', 'who');
  who.append(avatar(p));
  const names = el('div');
  names.append(el('b', null, fullName(p)));
  names.append(el('small', null, p.email || 'no e-mail'));
  who.append(names);
  tr.append(td(who));

  tr.append(td(el('span', null, roleLabel(p.role))));
  tr.append(td(el('span', p.employment === 'casual' ? 'pill warn' : 'pill', employmentLabel(p.employment))));

  const acct = p.has_login
    ? el('span', 'pill ok', 'Can sign in')
    : el('span', 'pill warn', 'No login');
  tr.append(td(acct));

  const chips = el('div', 'chips');
  const rs = p.responsibilities || [];
  if (!rs.length) chips.append(el('span', 'chip', '—'));
  rs.slice(0, 4).forEach(r => chips.append(r.category
    ? subFamilyTag(r.category, 'chip')
    : el('span', 'chip fam-' + r.family, 'All ' + r.family)));
  if (rs.length > 4) chips.append(el('span', 'chip', `+${rs.length - 4}`));
  tr.append(td(chips));

  const days = (p.working_days || []).map(d => DAYS.find(x => x[0] === d)?.[1][0] ?? '').join('');
  tr.append(td(el('span', 'mono', `${days} · ${Number(p.hours_per_day)}h`)));

  const acts = el('div', 'acts');
  const edit = el('button', 'btn btn-sm', 'Edit');
  edit.onclick = () => openPerson(p);
  const more = el('button', 'btn btn-sm btn-ghost', '⋯');
  more.setAttribute('aria-label', 'More actions for ' + p.name);
  more.onclick = () => openActions(p);
  acts.append(edit, more);
  tr.append(td(acts));
  return tr;
}

const td = child => { const c = el('td'); c.append(child); return c; };
// The surname shows here and in the form only; every other page shows the name alone.
const fullName = p => [p.name, p.surname].filter(Boolean).join(' ');

// ── add / edit ─────────────────────────────────────────────────────────────
function openPerson(p) {
  const isNew = !p;
  const d = drawer(isNew ? 'Add a person' : p.name,
                   isNew ? farm.name : roleLabel(p.role) + ' at ' + farm.name);

  const name = input({ id: 'p-name', value: p?.name ?? '', placeholder: 'First name, or Worker 1' });
  const surname = input({ id: 'p-surname', value: p?.surname ?? '', placeholder: 'Surname',
                          autocomplete: 'off' });
  const linkedin = input({ id: 'p-linkedin', type: 'url', value: p?.linkedin_url ?? '',
                           placeholder: 'https://www.linkedin.com/in/…', autocomplete: 'off' });
  const photo = photoPicker(p, name, linkedin);
  const role = selectBox(ROLES.map(r => [r[0], r[1]]), p?.role ?? 'worker');
  role.id = 'p-role';
  const roleHint = el('div', 'hint');
  const setRoleHint = () => {
    roleHint.textContent = ROLES.find(r => r[0] === role.value)?.[2] ?? '';
    slots.hidden = role.value !== 'worker';
  };

  // Worker 1…10 — the slot names the weekly roster uses. Taken ones are shown
  // but cannot be picked twice.
  const slots = el('div', 'row');
  slots.style.marginTop = '2px';
  const taken = new Set(people.filter(x => x.worker_id !== p?.worker_id).map(x => x.name));
  WORKER_SLOTS.forEach(s => {
    const b = el('button', 'toggle', s);
    b.type = 'button';
    if (taken.has(s)) { b.disabled = true; b.title = 'already at this FarmBox'; b.style.opacity = .4; }
    b.onclick = () => { name.value = s; name.dispatchEvent(new Event('input')); paintSlots(); };
    slots.append(b);
  });
  const paintSlots = () => [...slots.children].forEach(b =>
    b.setAttribute('aria-pressed', String(b.textContent === name.value)));
  name.addEventListener('input', paintSlots);
  role.onchange = setRoleHint;

  const email = input({ id: 'p-email', type: 'email', value: p?.email ?? '',
                        placeholder: 'name@farm.example', autocomplete: 'off' });
  const phone = input({ id: 'p-phone', value: p?.phone ?? '', placeholder: '+27 …' });

  // days and hours
  const dayRow = el('div', 'row');
  const chosen = new Set(p?.working_days ?? [1, 2, 3, 4, 5]);
  DAYS.forEach(([n, label]) => {
    const b = el('button', 'toggle', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(chosen.has(n)));
    b.onclick = () => {
      chosen.has(n) ? chosen.delete(n) : chosen.add(n);
      b.setAttribute('aria-pressed', String(chosen.has(n)));
    };
    dayRow.append(b);
  });
  const hours = input({ id: 'p-hours', type: 'number', min: '1', max: '12', step: '0.5',
                        value: String(p?.hours_per_day ?? 8) });
  const employment = selectBox(EMPLOYMENT.map(r => [r[0], r[1]]), p?.employment ?? 'permanent');
  employment.id = 'p-employment';
  const empHint = el('div', 'hint');
  const setEmpHint = () => { empHint.textContent = EMPLOYMENT.find(r => r[0] === employment.value)?.[2] ?? ''; };
  employment.onchange = setEmpHint;
  setEmpHint();

  // the account
  const acct = el('div', 'field');
  acct.append(el('label', null, 'Password'));
  const pw = input({ id: 'p-pw', type: 'text', autocomplete: 'new-password',
                     placeholder: isNew ? 'at least 10 characters' : 'leave empty to keep the current one' });
  const pwRow = el('div', 'row');
  pwRow.style.alignItems = 'stretch';
  pw.style.flex = '1';
  const gen = el('button', 'btn btn-sm', 'Suggest');
  gen.type = 'button';
  gen.onclick = () => { pw.value = suggestPassword(); pw.focus(); pw.select(); };
  pwRow.append(pw, gen);
  acct.append(pwRow);
  acct.append(el('div', 'hint', isNew
    ? 'They sign in to Naked Brain with this e-mail and password. Write it down before you save — it is not shown again.'
    : p.has_login
      ? 'Type a new password only if you are resetting it.'
      : 'Fill in an e-mail and a password to give this person a login.'));

  // responsibilities
  const resp = respPicker(p?.responsibilities ?? []);

  d.body.append(
    el('div', 'sec-title', 'The person'),
    field('Name', name),
    field('Surname', surname),
    field('LinkedIn profile link', linkedin),
    photo.node,
    slots,
    (() => { const f = field('Role', role); f.append(roleHint); return f; })(),
    (() => {
      const g = el('div', 'grid2');
      g.append(field('E-mail', email), field('Phone', phone));
      return g;
    })(),
    el('div', 'sec-title', 'Their week'),
    (() => { const f = field('Employment', employment); f.append(empHint); return f; })(),
    (() => { const f = el('div', 'field');
             f.append(el('label', null, 'Working days'), dayRow); return f; })(),
    field('Hours per day', hours),
    el('div', 'sec-title', 'Sign-in'),
    acct,
    el('div', 'sec-title', 'Responsible for'),
    el('div', 'hint',
       'Pick a family, then tick its sub-families — or All of it. Leave it empty and ' +
       'the planner will treat them as available for anything.'),
    resp.node,
  );
  setRoleHint();
  paintSlots();
  d.box.addEventListener('paste', photo.onPaste);

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', isNew ? 'Add person' : 'Save changes');
  save.onclick = async () => {
    const body = {
      farm_id: farm.id,
      worker_id: p?.worker_id ?? null,
      name: name.value.trim(),
      surname: surname.value.trim(),
      linkedin_url: linkedinUrl(linkedin.value),
      photo_url: photo.value(),
      role: role.value,
      email: email.value.trim() || null,
      phone: phone.value.trim() || null,
      working_days: [...chosen].sort((a, b) => a - b),
      hours_per_day: Number(hours.value) || 8,
      employment: employment.value,
      responsibilities: resp.value(),
    };
    if (!body.name) { toast('A name is needed', 'bad'); name.focus(); return; }
    if (!body.working_days.length) { toast('Pick at least one working day', 'bad'); return; }
    if (linkedin.value.trim() && !body.linkedin_url) {
      toast('That is not a LinkedIn link', 'bad'); linkedin.focus(); return;
    }

    const wantsAccount = !!pw.value.trim();
    if (wantsAccount && !body.email) { toast('A password needs an e-mail', 'bad'); email.focus(); return; }
    if (wantsAccount && pw.value.trim().length < 10) {
      toast('The password needs at least 10 characters', 'bad'); pw.focus(); return;
    }

    busy(save, true, isNew ? 'Adding…' : 'Saving…');
    try {
      if (wantsAccount && (isNew || !p.has_login)) {
        // account + access + person, in the edge function that holds the key
        const made = await fn('admin-user', { action: 'create', ...body, password: pw.value.trim() });
        // admin-user writes the account and the roster row; the profile
        // (surname, LinkedIn, picture) goes through save_person like any edit.
        await rpc('save_person', { p: { ...body, worker_id: made.worker_id } });
      } else {
        await rpc('save_person', { p: body });
        if (wantsAccount) {
          await fn('admin-user', { action: 'password', farm_id: farm.id,
                                   worker_id: p.worker_id, password: pw.value.trim() });
        }
      }
      d.close();
      toast(isNew ? `${body.name} added` : 'Saved', 'ok');
      await load();
    } catch (e) {
      busy(save, false, isNew ? 'Add person' : 'Save changes');
      toast(e.message, 'bad');
    }
  };
  d.footer.append(cancel, save);
}

// ── the picture ────────────────────────────────────────────────────────────
// Stored as a small square JPEG in the row itself (migration 0047), not as a
// link. LinkedIn lets no other site or server fetch a profile (it answers 999
// to cloud servers), so "from LinkedIn" is: open the profile, right-click the
// photo › Copy image, and paste it here (Ctrl+V, or the button). The owner
// found a one-click bookmark too complex (18 Sept 2026).
const PHOTO_PX = 160;

function linkedinUrl(v) {
  v = v.trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) ? u.href : '';
  } catch { return ''; }
}

function photoPicker(p, nameInput, linkedinInput) {
  let value = p?.photo_url ?? '';
  let waiting = false;
  const node = el('div', 'field');
  node.append(el('label', null, 'Picture'));

  const row = el('div', 'row photo-row');
  const preview = el('div', 'avatar lg photo-preview');
  const file = input({ type: 'file', accept: 'image/*' });
  file.hidden = true;
  const add = el('button', 'btn btn-sm', 'Add picture');
  add.type = 'button';
  const fromLi = el('button', 'btn btn-sm', 'Take picture from LinkedIn');
  fromLi.type = 'button';
  const remove = el('button', 'btn btn-sm btn-ghost', 'Remove');
  remove.type = 'button';
  row.append(preview, add, fromLi, remove, file);
  const steps = el('ol', 'hint photo-steps');
  ['Click Take picture from LinkedIn and the profile opens.',
   'Right-click their photo and choose Copy image.',
   'Come back to the form and press Ctrl+V, or click Paste picture.']
    .forEach(t => steps.append(el('li', null, t)));
  const hint = el('div', 'hint');
  node.append(row, steps, hint);

  const paint = msg => {
    preview.textContent = '';
    if (value) {
      const img = new Image();
      img.alt = '';
      img.src = value;
      preview.append(img);
      preview.classList.add('has-photo');
    } else {
      preview.classList.remove('has-photo');
      preview.textContent = (nameInput.value.trim()[0] || '?').toUpperCase();
    }
    remove.hidden = !value;
    hint.textContent = msg ?? '';
  };
  const done = () => { waiting = false; fromLi.textContent = 'Take picture from LinkedIn'; };
  const take = async blob => {
    try { value = await shrink(blob); done(); paint(); }
    catch { paint('That file is not a picture this browser can read.'); }
  };

  add.onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) take(file.files[0]); file.value = ''; };
  remove.onclick = () => { value = ''; paint(); };
  nameInput.addEventListener('input', () => { if (!value) preview.textContent =
    (nameInput.value.trim()[0] || '?').toUpperCase(); });

  // First press opens the profile; the second pastes the copied photo.
  fromLi.onclick = async () => {
    if (!waiting) {
      const url = linkedinUrl(linkedinInput.value);
      if (!url) { toast('Put their LinkedIn profile link in first', 'bad'); linkedinInput.focus(); return; }
      window.open(url, '_blank', 'noopener');
      waiting = true;
      fromLi.textContent = 'Paste picture';
      paint();
      return;
    }
    try {
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { await take(await it.getType(type)); return; }
      }
      paint('No picture on the clipboard yet — on LinkedIn, right-click the photo › Copy image.');
    } catch {
      paint('The browser would not read the clipboard — press Ctrl+V instead.');
    }
  };

  // Ctrl+V anywhere in the form; a paste of text into a field is left alone.
  const onPaste = e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    take(item.getAsFile());
  };

  paint();
  return { node, value: () => value, onPaste };
}

// Centre-crop to a square, scale to PHOTO_PX, JPEG.
async function shrink(blob) {
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = PHOTO_PX;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85);
}

// ── the responsibility picker ──────────────────────────────────────────────
// Pick a family from the menu, then its sub-families (or "All of <family>",
// which covers every one). What is chosen, across all families, shows above as
// coloured labels — click one to take it off. The list is Settings › Task
// families; family_tree adds how many procedures each has on this farm.
function respPicker(current) {
  const node = el('div', 'resp');
  const state = new Map(); // family -> { all: bool, cats: Set }
  const fams = families();
  fams.forEach(f => {
    state.set(f.name, {
      all: current.some(r => r.family === f.name && !r.category),
      cats: new Set(current.filter(r => r.family === f.name && r.category).map(r => r.category)),
    });
  });

  if (!fams.length) {
    node.append(el('div', 'note',
      'No task families yet. Add them in Settings › Task families and come back.'));
    return { node, value: () => [] };
  }

  // what is chosen, all families together
  const chosen = el('div', 'chips');
  chosen.style.marginBottom = 'var(--space-3)';
  const paintChosen = () => {
    chosen.textContent = '';
    for (const [family, s] of state) {
      const tags = s.all ? [el('span', 'chip fam-' + family, 'All ' + family)]
                         : [...s.cats].map(c => subFamilyTag(c, 'chip'));
      tags.forEach((t, i) => {
        t.style.cursor = 'pointer';
        t.title = 'Click to take it off';
        t.onclick = () => {
          if (s.all) s.all = false; else s.cats.delete([...s.cats][i]);
          paintChosen(); paintFamily();
        };
        chosen.append(t);
      });
    }
    if (!chosen.children.length) chosen.append(el('span', 'hint', 'Nothing yet — pick a family below.'));
  };

  // the family menu, then that family's sub-families
  const pick = el('select');
  fams.forEach(f => {
    const o = el('option', null, `${f.name} · ${f.procedures} procedure${f.procedures === 1 ? '' : 's'}`);
    o.value = f.name;
    pick.append(o);
  });
  const firstUsed = fams.find(f => state.get(f.name).all || state.get(f.name).cats.size);
  pick.value = (firstUsed || fams[0]).name;
  const subs = el('div', 'resp-cats');
  const paintFamily = () => {
    subs.textContent = '';
    const f = fams.find(x => x.name === pick.value);
    const s = state.get(f.name);
    const all = el('button', 'toggle all', 'All of ' + f.name);
    all.type = 'button';
    all.setAttribute('aria-pressed', String(s.all));
    all.onclick = () => { s.all = !s.all; if (s.all) s.cats.clear(); paintFamily(); paintChosen(); };
    subs.append(all);
    f.cats.forEach(c => {
      const b = el('button', 'toggle', c.procedures ? `${c.name} · ${c.procedures}` : c.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(s.cats.has(c.name)));
      b.onclick = () => {
        if (s.cats.has(c.name)) s.cats.delete(c.name); else s.cats.add(c.name);
        if (s.cats.size) s.all = false;
        paintFamily(); paintChosen();
      };
      subs.append(b);
    });
    if (!f.cats.length) subs.append(el('span', 'hint', 'No sub-families yet — the family covers it.'));
  };
  pick.onchange = paintFamily;

  const menu = el('div', 'row');
  menu.style.marginBottom = 'var(--space-2)';
  const lbl = el('span', 'hint', 'Family');
  const wrap = el('div', 'field');
  wrap.style.margin = '0';
  wrap.append(pick);
  menu.append(lbl, wrap);
  node.append(chosen, menu, subs);
  paintChosen();
  paintFamily();

  return {
    node,
    value: () => {
      const out = [];
      for (const [family, s] of state) {
        if (s.all) out.push({ family, category: null });
        else for (const category of s.cats) out.push({ family, category });
      }
      return out;
    },
  };
}

// ── the row menu ───────────────────────────────────────────────────────────
function openActions(p) {
  const d = drawer(p.name, roleLabel(p.role) + (p.active ? '' : ' · inactive'));
  const list = el('div', 'resp');

  const item = (label, hint, cls, run) => {
    const b = el('button', 'btn ' + (cls || ''), label);
    b.style.justifyContent = 'flex-start';
    b.onclick = run;
    const w = el('div', 'field');
    w.append(b);
    if (hint) w.append(el('div', 'hint', hint));
    list.append(w);
  };

  if (p.has_login) {
    item('Reset the password', 'Give them a new one to sign in with.', '', async () => {
      d.close();
      await resetPassword(p);
    });
    item('Remove the login', 'Keeps them on the roster and in the history; they can no longer sign in.',
         '', async () => {
      d.close();
      if (!await confirmDrawer('Remove the login?',
        `${p.name} will stay on the roster and keep every run they signed, but the account ` +
        `${p.email || ''} will be deleted.`, 'Remove the login', true)) return;
      await act({ action: 'unlink', worker_id: p.worker_id }, 'Login removed');
    });
  } else {
    item('Give them a login', 'Add an e-mail and a password on the Edit form.', '', () => {
      d.close(); openPerson(p);
    });
  }

  if (p.active) {
    item('Make inactive', 'They keep their history but drop out of next week’s plan.', 'btn-danger',
      async () => {
        d.close();
        if (!await confirmDrawer('Make inactive?',
          `${p.name} will not appear in the labour plan and cannot sign in. ` +
          `Everything they have done stays.`, 'Make inactive', true)) return;
        await act({ action: 'disable', worker_id: p.worker_id }, `${p.name} is now inactive`);
      });
  } else {
    item('Bring back', 'They return to the roster and can sign in again.', '', async () => {
      d.close();
      await act({ action: 'enable', worker_id: p.worker_id }, `${p.name} is active again`);
    });
  }

  if (p.open_tasks) {
    list.append(el('div', 'note',
      `${p.open_tasks} open task${p.open_tasks === 1 ? '' : 's'} are assigned to ${p.name}. ` +
      `Making them inactive leaves those tasks for the next plan to reassign.`));
  }

  d.body.append(list);
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

async function resetPassword(p) {
  const d = drawer('Reset the password', p.name);
  const pw = input({ type: 'text', value: suggestPassword(), autocomplete: 'new-password' });
  const row = el('div', 'row');
  pw.style.flex = '1';
  const gen = el('button', 'btn btn-sm', 'Suggest');
  gen.type = 'button';
  gen.onclick = () => { pw.value = suggestPassword(); };
  row.append(pw, gen);
  const f = el('div', 'field');
  f.append(el('label', null, 'New password'), row,
           el('div', 'hint', 'Write it down before you save — it is not shown again.'));
  d.body.append(f);

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Set password');
  ok.onclick = async () => {
    if (pw.value.trim().length < 10) { toast('At least 10 characters', 'bad'); return; }
    busy(ok, true, 'Setting…');
    try {
      await fn('admin-user', { action: 'password', farm_id: farm.id,
                               worker_id: p.worker_id, password: pw.value.trim() });
      d.close();
      toast('Password set', 'ok');
    } catch (e) { busy(ok, false, 'Set password'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}

async function act(body, okMessage) {
  try {
    await fn('admin-user', { farm_id: farm.id, ...body });
    toast(okMessage, 'ok');
    await load();
  } catch (e) { toast(e.message, 'bad'); }
}

// The farm switcher needs this too.
export const listFarms = () =>
  select('farm', 'select=id,name,code,status&order=name&status=eq.active');
