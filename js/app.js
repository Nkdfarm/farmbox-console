// Boot, sign-in, farm switcher, router. Everything else is a page module.
import { getSession, signIn, signOut, me, select, rpc,
         connection, onConnection, newPage, reconnect } from './api.js';
import { el, toast, icon, avatar, pref, setPhotos } from './ui.js';
import { renderPeople, roleLabel } from './people.js';
import { renderWeek, defaultWeek } from './week.js';
import { renderFarm } from './farm.js';
import { renderCrops } from './crops.js';
import { renderDashboard, calendarRange } from './dashboard.js';
import { renderProcedures } from './procedures.js';
import { renderCropDb } from './cropdb.js';
import { renderMaintenance } from './maintenance.js';
import { renderPurchasing } from './purchasing.js';
import { renderPrices } from './prices.js';
import { renderReports, reportRange } from './reports.js';
import { renderNetwork } from './network.js';
import { renderIssues } from './issues.js';
import { renderHarvest } from './harvest.js';
import { watchForUpdates, VERSION, updateProgress, finishUpdate } from './update.js';
import { openSettings, applyTheme, startPage } from './settings.js';

const $ = id => document.getElementById(id);
const FARM_KEY = 'fbc_farm';

// The rail's icons, the brand mark and the sign-out button are named in the
// markup and drawn here, so the SVGs live in one place (ui.js).
document.querySelectorAll('[data-icon]').forEach(n => n.prepend(icon(n.dataset.icon)));
// the page name as a tooltip, for when a narrow window folds the rail to icons
document.querySelectorAll('.rail a').forEach(a => { a.title = a.textContent.trim(); });

// The menu folds to its icons for more room on the page. A person's choice is
// remembered; until they make one, a narrow window folds it and a wide one
// opens it. The choice is also kept in memory, so a private window (no
// localStorage) still toggles.
const RAIL_KEY = 'fbc_rail';
const narrow = matchMedia('(max-width: 900px)');
let railChoice = pref.get(RAIL_KEY);

function paintRail() {
  const folded = railChoice ? railChoice === 'folded' : narrow.matches;
  $('shell').classList.toggle('collapsed', folded);
  const label = folded ? 'Expand the menu' : 'Collapse the menu';
  const t = $('railToggle');
  t.setAttribute('aria-expanded', String(!folded));
  t.setAttribute('aria-label', label);
  t.title = label;
}
$('railToggle').addEventListener('click', () => {
  railChoice = $('shell').classList.contains('collapsed') ? 'open' : 'folded';
  pref.set(RAIL_KEY, railChoice);
  paintRail();
});
narrow.addEventListener('change', paintRail);
paintRail();

let farms = [];
let farm = null;
let myUserId = null;
let myUser = null;
let myRoles = [];
let myWorkerId = null;   // the signed-in person's own worker row, when they have one

applyTheme();

const ROUTES = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  people: { title: 'People', render: renderPeople },
  week:   { title: 'Weekly plan', render: renderWeek },
  farm:   { title: 'Farm setup', render: renderFarm },
  crops:  { title: 'Crops & plan', render: renderCrops },
  cropdb: { title: 'Crop database', render: renderCropDb },
  harvest: { title: 'Harvest', render: renderHarvest },
  procedures: { title: 'Procedures', render: renderProcedures },
  maintenance: { title: 'Maintenance', render: renderMaintenance },
  purchasing: { title: 'Purchasing', render: renderPurchasing },
  prices: { title: 'Prices & market', render: renderPrices },
  reports: { title: 'Reports', render: renderReports },
  issues: { title: 'Issues', render: renderIssues },
  units:  { title: 'All FarmBoxes', render: renderNetwork },
};

// ── sign in ────────────────────────────────────────────────────────────────
function showSignin(message) {
  $('shell').hidden = true;
  $('signin').hidden = false;
  const err = $('si-err');
  err.hidden = !message;
  if (message) err.textContent = message;
  $('si-email').focus();
}

$('signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const go = $('si-go');
  go.disabled = true;
  $('si-err').hidden = true;
  try {
    await signIn($('si-email').value.trim(), $('si-pass').value);
    $('si-pass').value = '';
    await start();
  } catch (err) {
    showSignin(err.status === 400 ? 'That e-mail and password do not match.' : err.message);
  } finally {
    go.disabled = false;
  }
});

function doSignOut() {
  signOut();
  location.hash = '';
  showSignin();
}
$('signout').addEventListener('click', doSignOut);

// ── the gear ───────────────────────────────────────────────────────────────
$('settingsBtn').addEventListener('click', () => {
  const pill = $('envPill');
  openSettings({
    user: myUser || { id: myUserId, email: '' },
    workerId: myWorkerId,
    name: $('whoName').textContent,
    roleText: pill.textContent,
    roleTone: pill.classList.contains('ok') ? 'ok' : pill.classList.contains('warn') ? 'warn' : '',
    isFranchisor: myRoles.some(r => r.role === 'franchisor_admin'),
    railFolded: () => $('shell').classList.contains('collapsed'),
    setRailFolded: folded => {
      railChoice = folded ? 'folded' : 'open';
      pref.set(RAIL_KEY, railChoice);
      paintRail();
    },
    signOut: doSignOut,
    refresh: () => { if (farm) route(); },
  });
});

// ── the farm switcher ──────────────────────────────────────────────────────
// RLS decides what comes back: a farm manager sees one row, the franchisor
// sees every FarmBox in the world. Same query either way.
async function loadFarms() {
  // A FarmBox in setup has to be reachable, or a unit commissioned five
  // minutes ago cannot be configured: it is exactly the farm somebody needs
  // to open. Its state is shown beside the name rather than hidden.
  farms = await select('farm',
    'select=id,name,code,status&status=in.(active,setup)&order=name');
  const pick = $('farmPick');
  pick.textContent = '';
  farms.forEach(f => {
    const o = el('option', null,
      `${f.name} · ${f.code}` + (f.status === 'setup' ? ' · in setup' : ''));
    o.value = f.id;
    pick.append(o);
  });
  const wanted = pref.get(FARM_KEY);
  farm = farms.find(f => f.id === wanted) || farms[0] || null;
  if (farm) pick.value = farm.id;
  pick.disabled = farms.length < 2;
  pick.parentElement.hidden = farms.length === 0;
}

// What am I here? Franchisor first — it outranks anything farm-level.
async function paintMyRole() {
  const pill = $('envPill');
  try {
    const rows = await select('membership',
      `select=role,farm_id&user_id=eq.${myUserId}&active=is.true`);
    myRoles = rows;
    const franchisor = rows.some(r => r.role === 'franchisor_admin');
    const here = rows.find(r => r.farm_id === farm?.id);
    pill.textContent = franchisor ? 'Franchisor admin'
                     : here ? roleLabel(here.role) + ' here'
                     : 'No role here';
    pill.className = 'pill' + (franchisor || here ? ' ok' : ' warn');
  } catch { pill.hidden = true; }
}

// Switching FarmBox from anywhere: the picker, or a row on All FarmBoxes.
function switchFarm(id) {
  const next = farms.find(f => f.id === id);
  if (!next) return;
  farm = next;
  $('farmPick').value = farm.id;
  pref.set(FARM_KEY, farm.id);
  paintMyRole();
  location.hash = '#/dashboard';
  route();
  warm();
}

$('farmPick').addEventListener('change', e => {
  farm = farms.find(f => f.id === e.target.value) || farm;
  pref.set(FARM_KEY, farm.id);
  paintMyRole();
  route();
  warm();
});

// ── connected / offline ────────────────────────────────────────────────────
// Top right, always: a person has to know whether what is on screen is live
// before acting on it. Offline, a bar under the top says how old it is.
const clock = t => {
  const d = new Date(t);
  const today = d.toDateString() === new Date().toDateString();
  return (today ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ') +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function paintConnection({ phase, attempt, attempts, savedAt }) {
  const n = $('net');
  // Redrawn only when the phase changes, so the Connecting bar keeps its
  // place and fills smoothly from one attempt to the next.
  if (n.dataset.phase !== phase) {
    n.dataset.phase = phase;
    n.textContent = '';
    n.className = 'pill net ' +
      (phase === 'online' ? 'is-online' : phase === 'connecting' ? 'is-connecting' : 'warn');
    n.append(icon(phase === 'offline' ? 'wifiOff' : 'wifi'),
      el('span', null, phase === 'online' ? 'Connected'
                     : phase === 'connecting' ? 'Connecting…' : 'Offline'));
    if (phase === 'connecting') {
      const track = el('span', 'net-bar');
      track.append(el('i'));
      n.append(track);
    }
    n.disabled = phase !== 'offline';
  }
  if (phase === 'connecting') {
    const fill = n.querySelector('.net-bar i');
    void fill.offsetWidth;        // start the transition from where it is now
    fill.style.width = (attempt / attempts * 100) + '%';
    n.title = `No answer from the server — trying again (${attempt} of ${attempts})`;
  } else {
    n.title = phase === 'online' ? 'Connected — everything on screen is live'
                                 : 'Offline — read only. Click to try to connect again.';
  }

  const online = phase !== 'offline';
  const bar = $('offlineBar');
  bar.hidden = online;
  bar.textContent = online ? '' :
    'Offline — read only. ' + (savedAt
      ? `Showing what this device saved at ${clock(savedAt)}. `
      : 'Pages opened while connected can still be read. ') +
    'Changes need a connection.';
}
paintConnection(connection());
$('net').addEventListener('click', () => reconnect());

let wasOnline = connection().online;
onConnection(state => {
  paintConnection(state);
  if (state.online && !wasOnline) {
    // Back: replace the copy on screen with the real thing, or finish a start
    // that the lost signal interrupted.
    toast('Connected again', 'ok');
    if (!booted) { if (getSession()) start(); }
    else route();
  }
  wasOnline = state.online;
});

// Read every page's data ahead, once per farm per visit, so a page never
// opened today still opens when the signal drops. The same calls with the same
// arguments as the pages make, or the copy would sit under a different key.
// Drawers (a crop's or a procedure's detail) are read only when opened.
const warmed = new Set();
async function warm() {
  if (!farm || !connection().online || warmed.has(farm.id)) { finishUpdate(); return; }
  const id = farm.id;
  warmed.add(id);
  await new Promise(r => setTimeout(r, 2500));      // after the page itself
  const p = { p_farm: id };
  const calls = [
    ['dashboard', p], ['crop_calendar', { ...p, ...calendarRange() }],
    ['labour_week', { ...p, p_week: defaultWeek() }], ['crop_map', p],
    ['harvests', { ...p, p_days: 30 }], ['crop_library', p], ['procedures', p],
    ['maintenance', p], ['purchasing', p], ['price_table', p], ['market_trends', p],
    ['issues', { ...p, p_include_closed: false }], ['reports', { ...p, ...reportRange() }],
    ['people', p], ['family_tree', p], ['farm_market', p],
  ];
  if (myRoles.some(r => r.role === 'franchisor_admin')) calls.push(['farm_network', {}]);
  let done = 0;
  for (const [name, args] of calls) {
    if (!connection().online) { warmed.delete(id); finishUpdate(); return; }
    try { await rpc(name, args); } catch { /* the page will say so if it matters */ }
    updateProgress(++done, calls.length);
  }
  finishUpdate();
}

// ── routing ────────────────────────────────────────────────────────────────
function currentRoute() {
  const name = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/')[0];
  return ROUTES[name] ? name : 'dashboard';
}

async function route() {
  const name = currentRoute();
  document.querySelectorAll('.rail a').forEach(a =>
    a.dataset.route === name ? a.setAttribute('aria-current', 'page')
                             : a.removeAttribute('aria-current'));
  document.title = `${ROUTES[name].title} · FarmBox Console`;

  newPage();
  const page = $('page');
  if (!farm) {
    page.textContent = '';
    const e = el('div', 'empty');
    e.append(el('h3', null, 'No FarmBox yet'));
    e.append(el('p', null,
      'Your account can sign in but is not attached to a FarmBox. ' +
      'Ask an admin to add you, or create one from the franchisor dashboard.'));
    page.append(e);
    return;
  }
  try {
    await ROUTES[name].render(page, farm, { switchFarm, reloadFarms: loadFarms });
  } catch (err) {
    page.textContent = '';
    page.append(el('div', 'note bad', err.message));
  }
}

window.addEventListener('hashchange', route);

// Say so when a newer console is deployed: an installed tab can sit on an old
// copy of itself for days otherwise.
watchForUpdates();

// ── boot ───────────────────────────────────────────────────────────────────
let booted = false;
async function start() {
  $('signin').hidden = true;
  $('shell').hidden = false;
  try {
    const user = await me();
    myUserId = user.id;
    myUser = user;
    const name = user.user_metadata?.name || user.user_metadata?.full_name ||
      (user.email || '').split('@')[0].replace(/^./, c => c.toUpperCase());
    $('whoName').textContent = name;
    $('who').textContent = user.email || '';
    // The same face here as on People and the plan: those key on the worker
    // row, so find the signed-in person's. A franchisor admin has none and
    // keeps a face of their own.
    try {
      const mine = await select('worker', `select=id&user_id=eq.${user.id}&active=is.true&limit=1`);
      myWorkerId = mine[0]?.id ?? null;
    } catch { myWorkerId = null; }
    // everyone's own picture, for every avatar on every page (ui.js setPhotos)
    try { setPhotos(await select('worker', 'select=id,photo_url&photo_url=not.is.null')); } catch { /* demo faces */ }
    $('meAvatar').textContent = '';
    $('meAvatar').append(avatar({ worker_id: myWorkerId, id: user.id, name }));
    const v = document.getElementById('version');
    if (v) v.textContent = 'v' + VERSION;
    const tv = document.getElementById('topVersion');
    if (tv) tv.textContent = 'v' + VERSION;
    await loadFarms();
    await paintMyRole();
    if (!location.hash) location.hash = '#/' + startPage();
    booted = true;
    await route();
    warm();
  } catch (err) {
    // The server answering "no" about who you are is a dead session: expired or
    // revoked (401), or the account itself deleted (403, "user from sub claim
    // does not exist"). Either way the console must go back to the sign-in
    // form, not sit in an empty shell with a red toast.
    // A request that never reached the server is a lost signal, not a dead
    // session, and must not throw away a good one.
    if (err.status >= 400 && err.status < 500) {
      signOut();
      showSignin(err.status === 403
        ? 'That account no longer exists. Sign in again.'
        : 'Your session has ended. Sign in again.');
    } else {
      toast(err.message, 'bad');
    }
  }
}

if (getSession()) start(); else showSignin();
