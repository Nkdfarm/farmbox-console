// ═══════════════════════════════════════════════════════════════════════════
// Settings — the gear in the top right
//
// What belongs to this browser (the theme, the folded menu, the calendar's
// view, the page it opens on), who is signed in, which version is running, and
// the two Notion syncs. A setting that belongs to a FarmBox lives on Farm setup,
// not here: this panel is about the console, not the farm.
// ═══════════════════════════════════════════════════════════════════════════
import { api, fn } from './api.js';
import { el, toast, drawer, busy, icon, avatar, input } from './ui.js';
import { VERSION, checkForUpdate, updateNow } from './update.js';
import { setCalendarView } from './dashboard.js';

const THEME_KEY = 'fbc_theme';
const START_KEY = 'fbc_start';

const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }
  catch { /* private window: the choice lasts for this visit */ }
};

// ── theme ──────────────────────────────────────────────────────────────────
// 'dark' | 'light' | 'system'. index.html applies the saved one before the
// first paint so a light console never flashes dark; this keeps it in step
// afterwards, including when the computer itself switches while it is open.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  const t = get(THEME_KEY);
  return t === 'light' || t === 'system' ? t : 'dark';
}

export function applyTheme(choice = currentTheme()) {
  const resolved = choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#f3f3f5' : '#0b0b0d');
}
darkQuery.addEventListener('change', () => { if (currentTheme() === 'system') applyTheme(); });

export const startPage = () => get(START_KEY) || 'dashboard';

// ── the panel ──────────────────────────────────────────────────────────────
// ctx comes from app.js: { user, name, roleText, roleTone, isFranchisor,
// railFolded(), setRailFolded(bool), signOut(), refresh() }
export function openSettings(ctx) {
  const d = drawer('Settings', 'This console, on this device');
  d.box.classList.add('settings');
  d.body.append(
    section('Appearance', appearance()),
    section('Layout', layout(ctx)),
    section('Notion', notion(ctx)),
    section('Account', account(ctx, d)),
    section('Version', version()),
    section('This device', device()),
  );
  const close = el('button', 'btn', 'Close');
  close.onclick = () => { d.close(); ctx.refresh?.(); };
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

// ── appearance ─────────────────────────────────────────────────────────────
function appearance() {
  const list = el('div', 'set-list');
  list.append(row('Theme', 'Dark, light, or follow this computer.',
    segmented([['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', 'monitor']],
      currentTheme(), v => { put(THEME_KEY, v); applyTheme(v); }, 'Theme')));
  return list;
}

// ── layout ─────────────────────────────────────────────────────────────────
function layout(ctx) {
  const list = el('div', 'set-list');
  list.append(row('Fold the menu to icons', 'The same as the arrow beside the logo.',
    switchBox(ctx.railFolded(), v => ctx.setRailFolded(v), 'Fold the menu to icons')));

  list.append(row('Crop calendar opens on', 'The view the dashboard calendar starts with.',
    segmented([['week', 'Week'], ['month', 'Month'], ['year', 'Year']],
      get('fbc_cal_view') || 'week', v => setCalendarView(v), 'Calendar view')));

  const pick = el('select');
  pick.setAttribute('aria-label', 'Start page');
  [['dashboard', 'Dashboard'], ['week', 'Weekly plan'], ['crops', 'Crops & plan'],
   ['harvest', 'Harvest'], ['people', 'People']].forEach(([v, label]) => {
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
  who.append(avatar({ id: ctx.user.id, name: ctx.name }, 'lg'));
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
  t.append(el('b', null, `FarmBox Console ${VERSION}`), status);
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

// ── this device ────────────────────────────────────────────────────────────
function device() {
  const list = el('div', 'set-list');
  const reset = el('button', 'btn btn-sm', 'Reset');
  reset.type = 'button';
  reset.onclick = () => {
    ['fbc_theme', 'fbc_rail', 'fbc_cal_view', 'fbc_start', 'fbc_farm'].forEach(k => put(k, null));
    applyTheme('dark');
    toast('Preferences reset on this device', 'ok');
    setTimeout(() => location.reload(), 700);
  };
  list.append(row('Reset preferences',
    'Theme, menu, calendar view, start page and the last FarmBox chosen. Your account and the farm’s data are not touched.',
    reset));

  const fresh = el('button', 'btn btn-sm', 'Reload');
  fresh.type = 'button';
  fresh.onclick = () => updateNow(VERSION);
  list.append(row('Reload a fresh copy',
    'Empties the offline copy and loads the console again from the server.', fresh));
  return list;
}
