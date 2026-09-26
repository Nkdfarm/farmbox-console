// ═══════════════════════════════════════════════════════════════════════════
// Settings — the gear in the top right
//
// What belongs to this browser (the theme, the folded menu, the calendar's
// view, the page it opens on), who is signed in, which version is running, and
// the two Notion syncs. A setting that belongs to a FarmBox lives on Farm setup,
// not here: this panel is about the console, not the farm.
// ═══════════════════════════════════════════════════════════════════════════
import { api, fn, select, rpc } from './api.js';
import { el, toast, drawer, busy, icon, avatar, input, pref } from './ui.js';
import { VERSION, checkForUpdate, updateNow } from './update.js';
import { setCalendarView, calendarView } from './dashboard.js';
import { familiesRow } from './families.js';

const THEME_KEY = 'fbc_theme';
const START_KEY = 'fbc_start';

const { get, set: put } = pref;

// ── theme ──────────────────────────────────────────────────────────────────
// 'dark' | 'light' | 'system'. index.html applies the saved one before the
// first paint so a light console never flashes dark; this keeps it in step
// afterwards, including when the computer itself switches while it is open.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  const t = get(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'system';   // nothing chosen yet: follow the computer
}

export function applyTheme(choice = currentTheme()) {
  const resolved = choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#f3f3f5' : '#0b0b0d');
}
darkQuery.addEventListener('change', () => { if (currentTheme() === 'system') applyTheme(); });

// 'harvest' was a page until 0.7.68 (removed at the owner's request): a device that still opens on it lands on the dashboard
// the sections of 0.7.70; a device that chose one of the old pages lands in its section
const OLD_START = { crops: 'grow', cropdb: 'grow', procedures: 'grow', people: 'farm', harvest: 'grow', prices: 'office', purchasing: 'office', issues: 'dashboard', reports: 'dashboard' };
export const startPage = () => { const s = get(START_KEY); return !s ? 'dashboard' : (OLD_START[s] || s); };

// ── the panel ──────────────────────────────────────────────────────────────
// ctx comes from app.js: { user, name, roleText, roleTone, isFranchisor,
// railFolded(), setRailFolded(bool), signOut(), refresh() }
//
// The theme and the menu apply as they are changed. The calendar's view is the
// one setting the page on screen has to be redrawn for, so the page is
// refreshed only when that changed — and however the panel was closed:
// the button, the scrim, the cross or Escape all go through onClose.
export function openSettings(ctx) {
  const touched = { page: false };
  const d = drawer('Settings', 'This console, on this device',
    { onClose: () => { if (touched.page) ctx.refresh?.(); } });
  d.box.classList.add('settings');
  d.body.append(
    section('FarmBox', farmBox(ctx, d)),
    section('Appearance', appearance()),
    section('Layout', layout(ctx, touched)),
    section('Notion', notion(ctx)),
    section('Task families', (() => { const l = el('div', 'set-list'); l.append(familiesRow()); return l; })()),
    section('Integrations', integrations()),
    section('Account', account(ctx, d)),
    section('Version', version()),
    section('Version log', versionLog()),
    section('This device', device()),
  );
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

function section(title, body) {
  const s = el('section', 'set-sec');
  s.append(el('h3', 'set-title', title), body);
  return s;
}

// words on the left, the control on the right
function row(label, hint, ...controls) {
  const r = el('div', 'set-row');
  const t = el('div', 'set-text');
  t.append(el('b', null, label));
  if (hint) t.append(el('small', null, hint));
  r.append(t);
  controls.filter(Boolean).forEach(c => r.append(c));
  return r;
}

function segmented(options, value, onPick, label) {
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', label);
  const paint = v => [...seg.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  options.forEach(([v, text, glyph]) => {
    const b = el('button', 'seg-btn');
    b.type = 'button';
    b.dataset.v = v;
    if (glyph) b.append(icon(glyph));
    b.append(document.createTextNode(text));
    b.onclick = () => { paint(v); onPick(v); };
    seg.append(b);
  });
  paint(value);
  return seg;
}

function switchBox(on, onChange, label) {
  const b = el('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  b.setAttribute('aria-label', label);
  b.onclick = () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    onChange(next);
  };
  return b;
}

// ── farmbox ────────────────────────────────────────────────────────────────
// Which FarmBox every page shows — the same switch as the picker in the top
// bar, remembered on this device. The list is whatever RLS lets this account read.
function farmBox(ctx, d) {
  const list = el('div', 'set-list');
  const farms = ctx.farms || [];
  if (!farms.length) {
    list.append(el('div', 'note', 'This account can open no FarmBox yet.'));
    return list;
  }
  const pick = el('select');
  pick.setAttribute('aria-label', 'FarmBox');
  farms.forEach(f => {
    const o = el('option', null,
      `${f.name} · ${f.code}` + (f.status === 'setup' ? ' · in setup' : ''));
    o.value = f.id;
    pick.append(o);
  });
  pick.value = ctx.farmId || farms[0].id;
  pick.disabled = farms.length < 2;
  pick.onchange = () => {
    ctx.switchFarm(pick.value);
    const f = farms.find(x => x.id === pick.value);
    toast(`Now showing ${f?.name || 'that FarmBox'}`, 'ok');
    d.close();
  };
  const f = el('div', 'field');
  f.append(pick);
  list.append(row('Farm', farms.length < 2
    ? 'This account has access to one FarmBox only.'
    : 'Every page shows this FarmBox. Remembered on this device.', f));
  return list;
}

// ── integrations ───────────────────────────────────────────────────────────
// API keys for outside services (migration 0059). The key is kept on the server
// and never comes back here: the panel only learns whether one is set and its
// last 4 characters. The franchisor sets it; everyone else sees the status.
// The keys of outside services, pasted here by the franchisor and kept in the
// database (app.integration_key); the console only ever sees "set" + last 4.
const INTEGRATIONS = [
  { name: 'farmazone', label: 'Farmazone API key', placeholder: 'fz_live_…',
    setText: 'The market scan uses it.', unsetText: 'Not set — the market scan reads only the Cape Town Market page.',
    savedToast: 'Farmazone key saved — the next scan uses it',
    help: 'Farmazone’s fresh-produce prices need it. Sign in at Farmazone › Developer Dashboard › generate a key ' +
          '(free: 100 requests a day; one market scan uses 7). ',
    link: ['Farmazone API page', 'https://farmazone.co.za/api/v1/docs/'] },
  { name: 'anthropic', label: 'Anthropic API key', placeholder: 'sk-ant-…',
    setText: 'A photo goes to Claude when somebody presses Ask the AI on it, in Pest & diseases.',
    unsetText: 'Not set — photos are counted and tagged by people only; the AI cannot be asked.',
    savedToast: 'Anthropic key saved — Ask the AI works on any photo now',
    help: 'Pest & diseases needs it: a trap or plant photo goes to Claude (Anthropic) only when somebody asks, photo by ' +
          'photo; it names the insects or the disease against the catalogue. Create a key in the Anthropic Console (a photo costs a few cents). ',
    link: ['Anthropic Console', 'https://console.anthropic.com/settings/keys'] },
];

function integrations() {
  const list = el('div', 'set-list');
  const rows = INTEGRATIONS.map(def => {
    const status = el('small', null, 'Reading…');
    const text = el('div', 'set-text');
    text.append(el('b', null, def.label), status);
    const r = el('div', 'set-row');
    r.append(text);
    const help = el('div', 'hint');
    help.style.padding = '0 var(--space-4) var(--space-3)';
    help.append(document.createTextNode(def.help));
    const a = el('a', null, def.link[0]);
    a.href = def.link[1];
    a.target = '_blank';
    a.rel = 'noopener';
    help.append(a);
    list.append(r, help);
    return { def, r, status };
  });

  const paint = st => rows.forEach(({ def, r, status }) => {
    const k0 = st?.[def.name];
    status.textContent = k0?.set
      ? `Set${k0.last4 ? ` — ends in ${k0.last4}` : ''}. ${def.setText}`
      : def.unsetText;
    r.querySelectorAll('.key-ctl').forEach(n => n.remove());
    if (!st?.may_edit) return;
    const k = input({ type: 'password', placeholder: k0?.set ? 'Paste a new key to replace it' : def.placeholder,
                      autocomplete: 'off' });
    k.className = 'key-ctl';
    k.spellcheck = false;
    k.style.maxWidth = '220px';
    const save = el('button', 'btn btn-sm btn-primary key-ctl', 'Save');
    save.onclick = async () => {
      const v = k.value.trim();
      if (!v) { toast('Paste the key first', 'bad'); return; }
      busy(save, true, 'Saving…');
      try {
        const st2 = await rpc('set_integration_key', { p_name: def.name, p_value: v });
        k.value = '';
        toast(def.savedToast, 'ok');
        paint(st2);
      } catch (e) { busy(save, false, 'Save'); toast(e.message, 'bad'); }
    };
    r.append(k, save);
    if (k0?.set) {
      const rm = el('button', 'btn btn-sm key-ctl', 'Remove');
      rm.onclick = async () => {
        try {
          paint(await rpc('set_integration_key', { p_name: def.name, p_value: '' }));
          toast(`${def.label} removed`, 'ok');
        } catch (e) { toast(e.message, 'bad'); }
      };
      r.append(rm);
    }
  });
  rpc('integration_status', {}).then(paint).catch(e => { rows.forEach(x => { x.status.textContent = e.message; }); });
  return list;
}

// ── appearance ─────────────────────────────────────────────────────────────
function appearance() {
  const list = el('div', 'set-list');
  list.append(row('Theme', 'Dark, light, or follow this computer.',
    segmented([['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', 'monitor']],
      currentTheme(), v => { put(THEME_KEY, v); applyTheme(v); }, 'Theme')));
  return list;
}

// ── layout ─────────────────────────────────────────────────────────────────
function layout(ctx, touched) {
  const list = el('div', 'set-list');
  list.append(row('Fold the menu to icons', 'The same as the arrow beside the logo.',
    switchBox(ctx.railFolded(), v => ctx.setRailFolded(v), 'Fold the menu to icons')));

  list.append(row('Crop calendar opens on', 'The view the dashboard calendar starts with.',
    segmented([['week', 'Week'], ['month', 'Month'], ['year', 'Year']],
      calendarView(), v => { setCalendarView(v); touched.page = true; }, 'Calendar view')));

  const pick = el('select');
  pick.setAttribute('aria-label', 'Start page');
  [['dashboard', 'Dashboard'], ['week', 'Tasks'], ['grow', 'Grow'], ['ipm', 'Pest & diseases'], ['office', 'Office'],
   ['maintenance', 'Maintenance'], ['farm', 'Farm setup']].forEach(([v, label]) => {
    const o = el('option', null, label);
    o.value = v;
    pick.append(o);
  });
  pick.value = startPage();
  pick.onchange = () => put(START_KEY, pick.value === 'dashboard' ? null : pick.value);
  const f = el('div', 'field');
  f.append(pick);
  list.append(row('Start page', 'Where the console opens when no page is in the address.', f));
  return list;
}

// ── Notion ─────────────────────────────────────────────────────────────────
const SECTION_LABEL = { farms: 'Farms', workers: 'People', prices: 'Prices' };

function notion(ctx) {
  const list = el('div', 'set-list');
  if (!ctx.isFranchisor) {
    list.append(el('div', 'note',
      'Only a franchisor admin can run the Notion syncs: they change data every FarmBox shares.'));
  }

  list.append(syncCard(ctx, {
    fnName: 'notion-sync',
    title: 'From Notion to app',
    glyph: 'download',
    hint: 'Procedures and their checklist steps. A changed checklist arrives as a new draft ' +
          'version, and nothing goes live until it is approved in Notion.',
    summary: r => [
      `${r.read ?? 0} read`, `${r.created ?? 0} new`, `${r.updated ?? 0} updated`,
      `${r.unchanged ?? 0} unchanged`,
      r.versioned ? `${r.versioned} new checklist version${r.versioned === 1 ? '' : 's'}` : '',
      r.skipped ? `${r.skipped} skipped` : '',
    ].filter(Boolean).join(' · '),
    lines: () => [],
  }));

  list.append(syncCard(ctx, {
    fnName: 'notion-push',
    title: 'From app to Notion',
    glyph: 'upload',
    hint: 'Farms, people and recorded prices, into the Notion database twin. Procedures and ' +
          'their approval are never written back — Notion owns those.',
    summary: r => Object.keys(SECTION_LABEL).filter(k => r[k]).map(k =>
      `${SECTION_LABEL[k]}: ${r[k].created} new, ${r[k].updated} changed, ${r[k].unchanged} same`
      + (r[k].skipped ? `, ${r[k].skipped} skipped` : '')).join(' · '),
    lines: r => Object.keys(SECTION_LABEL).flatMap(k => r[k]?.changes ?? []),
  }));
  return list;
}

// Preview first, always: the button that writes stays off until a preview has
// shown what it would do, and goes off again once it has done it.
function syncCard(ctx, o) {
  const card = el('div', 'sync-card');
  const head = el('div', 'sync-head');
  const badge = el('div', 'sync-icon');
  badge.append(icon(o.glyph));
  const t = el('div', 'set-text');
  t.append(el('b', null, o.title), el('small', null, o.hint));
  head.append(badge, t);

  const lastKey = 'fbc_sync_' + o.fnName;
  const last = el('div', 'hint sync-last');
  const paintLast = () => {
    const raw = get(lastKey);
    if (!raw) { last.textContent = 'Not run from this device yet.'; return; }
    try {
      const x = JSON.parse(raw);
      last.textContent = 'Last run ' + new Date(x.at).toLocaleString(undefined,
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      last.title = x.summary;
    } catch { last.textContent = ''; }
  };
  paintLast();

  const out = el('div', 'sync-out');
  out.hidden = true;
  const preview = el('button', 'btn btn-sm', 'Preview');
  const run = el('button', 'btn btn-sm btn-primary', 'Sync now');
  preview.type = run.type = 'button';
  preview.disabled = !ctx.isFranchisor;
  run.disabled = true;
  run.title = 'Preview first';

  const go = async (dry, button) => {
    const label = dry ? 'Preview' : 'Sync now';
    busy(button, true, dry ? 'Reading…' : 'Syncing…');
    out.hidden = false;
    out.textContent = '';
    try {
      const r = await fn(o.fnName, { dry_run: dry });
      busy(button, false, label);
      const summary = o.summary(r) || 'Done.';
      out.append(el('div', 'sync-sum', (dry ? 'Preview — nothing written. ' : 'Synced. ') + summary));
      (r.errors || []).slice(0, 8).forEach(e => out.append(el('div', 'note bad', e)));
      const lines = o.lines(r);
      if (lines.length) {
        const ul = el('ul', 'sync-lines');
        lines.slice(0, 14).forEach(x => ul.append(el('li', null, x)));
        if (lines.length > 14) ul.append(el('li', 'more', `and ${lines.length - 14} more`));
        out.append(ul);
      }
      if (dry) {
        run.disabled = !ctx.isFranchisor;
        run.title = '';
      } else {
        put(lastKey, JSON.stringify({ at: Date.now(), summary }));
        paintLast();
        run.disabled = true;
        run.title = 'Preview again first';
        toast(`${o.title}: done`, 'ok');
      }
    } catch (e) {
      busy(button, false, label);
      const missing = e.status === 404 || /not found|failed to fetch/i.test(e.message);
      out.append(el('div', 'note bad', missing
        ? `The ${o.fnName} function is not installed on the server yet.`
        : e.message));
    }
  };
  preview.onclick = () => go(true, preview);
  run.onclick = () => go(false, run);

  const acts = el('div', 'sync-acts');
  acts.append(last, el('span', 'spacer'), preview, run);
  card.append(head, acts, out);
  return card;
}

// ── account ────────────────────────────────────────────────────────────────
function account(ctx, d) {
  const list = el('div', 'set-list');

  const me = el('div', 'set-row');
  const who = el('div', 'who');
  who.append(avatar({ worker_id: ctx.workerId, id: ctx.user.id, name: ctx.name }, 'lg'));
  const names = el('div');
  names.append(el('b', null, ctx.name), el('small', null, ctx.user.email || ''));
  who.append(names);
  who.style.flex = '1';
  me.append(who, el('span', 'pill ' + (ctx.roleTone || ''), ctx.roleText || ''));
  list.append(me);

  // the password form opens under its row, so the panel does not start with
  // two empty password fields in it
  const form = el('div', 'pw-form');
  form.hidden = true;
  const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'New password' });
  const pw2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
  const save = el('button', 'btn btn-sm btn-primary', 'Save password');
  save.type = 'button';
  const f1 = el('div', 'field'); f1.append(pw);
  const f2 = el('div', 'field'); f2.append(pw2);
  form.append(f1, f2, save);

  const open = el('button', 'btn btn-sm', 'Change');
  open.type = 'button';
  open.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) pw.focus(); };
  save.onclick = async () => {
    if (pw.value.length < 10) { toast('At least 10 characters', 'bad'); pw.focus(); return; }
    if (pw.value !== pw2.value) { toast('The two passwords are not the same', 'bad'); pw2.focus(); return; }
    busy(save, true, 'Saving…');
    try {
      await api('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: pw.value }) });
      busy(save, false, 'Save password');
      pw.value = pw2.value = '';
      form.hidden = true;
      toast('Password changed', 'ok');
    } catch (e) {
      busy(save, false, 'Save password');
      toast(e.message, 'bad');
    }
  };
  list.append(row('Password', 'The one you sign in with, here and on the phone.', open));
  list.append(form);

  const out = el('button', 'btn btn-sm btn-danger');
  out.type = 'button';
  out.append(icon('logout'), document.createTextNode('Sign out'));
  out.onclick = () => { d.close(); ctx.signOut(); };
  list.append(row('Sign out', 'On this device only.', out));
  return list;
}

// ── version ────────────────────────────────────────────────────────────────
function version() {
  const list = el('div', 'set-list');
  const status = el('small', null, 'Checking for updates…');
  const t = el('div', 'set-text');
  t.append(el('b', null, `Naked Heart ${VERSION}`), status);
  const btn = el('button', 'btn btn-sm', 'Check again');
  btn.type = 'button';
  const r = el('div', 'set-row');
  r.append(t, btn);

  const paint = async () => {
    btn.disabled = true;
    status.textContent = 'Checking for updates…';
    const info = await checkForUpdate();
    btn.disabled = false;
    if (!info?.version) {
      status.textContent = 'Could not reach the server to check.';
      btn.className = 'btn btn-sm';
      btn.textContent = 'Check again';
      btn.onclick = paint;
    } else if (info.version === VERSION) {
      status.textContent = `Up to date · released ${info.released ?? '—'}` + (info.note ? ` · ${info.note}` : '');
      btn.className = 'btn btn-sm';
      btn.textContent = 'Check again';
      btn.onclick = paint;
    } else {
      status.textContent = `Version ${info.version} is ready` + (info.note ? ` — ${info.note}` : '');
      btn.className = 'btn btn-sm btn-primary';
      btn.textContent = 'Update now';
      btn.onclick = () => updateNow(info.version);
    }
  };
  btn.onclick = paint;
  paint();
  list.append(r);
  return list;
}

// ── version log ────────────────────────────────────────────────────────────
// Every release of the console, newest first (release_note, migration 0048;
// mirrored in the Notion twin's Version Log). Numbers were pulled back to
// 0.7.x on 18 Sept 2026; the number a release had before is shown beside it.
function versionLog() {
  const list = el('div', 'set-list');
  const wait = el('div', 'set-row');
  wait.append(el('small', 'hint', 'Loading the version log…'));
  list.append(wait);
  const SHOWN = 6;

  select('release_note', 'select=version,released,title,summary,old_version&app=eq.console&order=seq.desc')
    .then(rows => {
      list.textContent = '';
      if (!rows?.length) { list.append(el('div', 'note', 'No releases recorded yet.')); return; }
      const items = rows.map(r => {
        const it = el('div', 'set-row rel-row');
        const t = el('div', 'set-text');
        const head = el('b');
        head.append(el('span', 'rel-v' + (r.version === VERSION ? ' current' : ''), r.version), ' ' + r.title);
        const when = new Date(r.released + 'T12:00:00').toLocaleDateString('en-ZA',
          { day: 'numeric', month: 'short', year: 'numeric' });
        t.append(head, el('small', null, r.summary ?? ''),
          el('small', 'rel-meta', when + (r.old_version ? ` · was ${r.old_version}` : '')));
        it.append(t);
        return it;
      });
      items.forEach((it, i) => { it.hidden = i >= SHOWN; list.append(it); });
      if (items.length > SHOWN) {
        const more = el('button', 'btn btn-sm btn-ghost', `Show all ${items.length} releases`);
        more.type = 'button';
        more.onclick = () => { items.forEach(it => { it.hidden = false; }); more.parentElement.remove(); };
        const r = el('div', 'set-row');
        r.append(more);
        list.append(r);
      }
    })
    .catch(e => { list.textContent = ''; list.append(el('div', 'note bad', e.message)); });
  return list;
}

// ── this device ────────────────────────────────────────────────────────────
function device() {
  const list = el('div', 'set-list');
  const reset = el('button', 'btn btn-sm', 'Reset');
  reset.type = 'button';
  reset.onclick = () => {
    ['fbc_theme', 'fbc_rail', 'fbc_cal_view', 'fbc_start', 'fbc_farm', 'fbc_zoom'].forEach(k => put(k, null));
    applyTheme('system');
    toast('Preferences reset on this device', 'ok');
    setTimeout(() => location.reload(), 700);
  };
  list.append(row('Reset preferences',
    'Theme, menu, zoom, calendar view, start page and the last FarmBox chosen. Your account and the farm’s data are not touched.',
    reset));

  const fresh = el('button', 'btn btn-sm', 'Reload');
  fresh.type = 'button';
  fresh.onclick = () => updateNow(VERSION);
  list.append(row('Reload a fresh copy',
    'Empties the offline copy and loads the console again from the server.', fresh));
  return list;
}
