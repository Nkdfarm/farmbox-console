// ═══════════════════════════════════════════════════════════════════════════
// A person's profile window and its actions (spec §7.x) — opened from Tasks › Team
//
// One form for what used to be three trips through the Supabase dashboard: the
// account they sign in with, the access it carries, the job and the week. What
// they are responsible for, and in which order, is the Team page (team.js).
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, fn, select } from './api.js';
import { el, field, input, selectBox, toast, drawer, confirmDrawer, suggestPassword, busy, faceIcon } from './ui.js';

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
let people = [];      // the site's people, as people() answers them
let afterSave = async () => {};

// The Team page (Tasks › Team, 0.7.222) is where the people are listed; it opens these windows and hands over
// the farm, the people and what to do after a change. What somebody is responsible for is set there, not here.
const take = ctx => { farm = ctx.farm; people = ctx.people || []; afterSave = ctx.done || (async () => {}); };
export function editPerson(ctx, p) { take(ctx); openPerson(p); }
export function personActions(ctx, p) { take(ctx); openActions(p); }

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
    el('div', 'hint', isNew
      ? 'What their job covers is theirs as soon as they are saved (Team › Jobs…). Add or take off a label, and set their numbers, on the Team page.'
      : 'Set on the Team page: click a label to change its number, ＋ to add one. A change of job brings the new job’s labels.'),
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
      await afterSave();
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
      preview.append(faceIcon());
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
    await afterSave();
  } catch (e) { toast(e.message, 'bad'); }
}

// The farm switcher needs this too.
export const listFarms = () =>
  select('farm', 'select=id,name,code,status&order=name&status=eq.active');
