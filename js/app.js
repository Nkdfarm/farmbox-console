// Boot, sign-in, farm switcher, router. Everything else is a page module.
import { getSession, signIn, signOut, me, select, rpc,
         connection, onConnection, newPage, reconnect } from './api.js';
import { el, toast, icon, avatar, pref, setPhotos } from './ui.js';
import { renderPeople, roleLabel } from './people.js';
import { renderWeek, defaultWeek, nextWeek } from './week.js';
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
import { renderIpm } from './ipm.js';
import { renderHarvest, harvestRange } from './harvest.js';
import { watchForUpdates, VERSION, updateProgress, finishUpdate } from './update.js';
import { loadCatalog } from './catalog.js';
import { loadFamilies } from './families.js';
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

// ── zoom ───────────────────────────────────────────────────────────────────
// − 100% + in the top bar scales the whole console (CSS zoom on <html>, see
// styles.css). Remembered on this device as fbc_zoom and applied before the
// first paint by index.html. Clicking the percentage goes back to 100%.
const ZOOM_KEY = 'fbc_zoom';
const ZOOM_MIN = 0.6, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1;
let zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, parseFloat(pref.get(ZOOM_KEY)) || 1));

function setZoom(z) {
  zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
  document.documentElement.style.setProperty('--zoom', zoom);
  pref.set(ZOOM_KEY, zoom === 1 ? null : String(zoom));
  paintZoom();
}
const zoomOut = el('button', null, '−');
const zoomLevel = el('button', 'zoom-level');
const zoomIn = el('button', null, '+');
zoomOut.type = zoomLevel.type = zoomIn.type = 'button';
zoomOut.setAttribute('aria-label', 'Zoom out');
zoomIn.setAttribute('aria-label', 'Zoom in');
zoomOut.title = 'Smaller';
zoomIn.title = 'Bigger';
zoomLevel.title = 'Back to 100%';
zoomOut.onclick = () => setZoom(zoom - ZOOM_STEP);
zoomIn.onclick = () => setZoom(zoom + ZOOM_STEP);
zoomLevel.onclick = () => setZoom(1);
function paintZoom() {
  zoomLevel.textContent = Math.round(zoom * 100) + '%';
  zoomOut.disabled = zoom <= ZOOM_MIN + 1e-9;
  zoomIn.disabled = zoom >= ZOOM_MAX - 1e-9;
}
$('zoom').append(zoomOut, zoomLevel, zoomIn);
setZoom(zoom);

let farms = [];
let farm = null;
let myUserId = null;
let myUser = null;
let myRoles = [];
let myWorkerId = null;   // the signed-in person's own worker row, when they have one

applyTheme();

// ── the map of the console (0.7.70) ────────────────────────────────────────
// Seven sections, one per responsibility — Dashboard, Tasks, Grow, IPM, Office,
// Maintenance, Farm setup — each with tabs across the top. The procedures are
// not one page any more: each library shows its own family (the crop ones
// live in the Crop library). Addresses read #/section/tab; the old one-word
// addresses still open the right place (MOVED).
const LIB = {
  routines: { title: 'Routines', keep: p => p.family === 'Agriculture' && p.trigger !== 'crop_plan' && p.category !== 'Pest & disease',
    blurb: 'The growing work that is not tied to one crop — irrigation, nutrients and water, climate, sanitation, the daily and weekly rounds. The crop-specific procedures are in the Crop library.' },
  ipm: { title: 'IPM programs', keep: p => p.category === 'Pest & disease',
    blurb: 'Scouting, the sticky-trap round, treatments: every Pest & disease procedure.' },
  office: { title: 'Farm management', keep: p => p.family === 'Office',
    blurb: 'The office procedures: admin, orders and deliveries, the weekend remote check.' },
  maintenance: { title: 'Preventive maintenance', keep: p => p.family === 'Maintenance',
    blurb: 'The maintenance procedures the equipment rules call, at their own interval.' },
};
const lib = key => (c, f, ctx) => renderProcedures(c, f, LIB[key]);

const SECTIONS = {
  dashboard: { title: 'Dashboard', tabs: [
    ['overview', 'Overview', renderDashboard], ['issues', 'Issues', renderIssues], ['reports', 'Reports', renderReports]] },
  week: { title: 'Tasks', tabs: [['board', 'Tasks', renderWeek]] },
  grow: { title: 'Grow', tabs: [
    ['planner', 'Crop planner', renderCrops], ['library', 'Crop library', renderCropDb], ['routines', 'Routines', lib('routines')],
    ['harvest', 'Harvest', renderHarvest]] },
  ipm: { title: 'IPM', tabs: [['traps', 'Traps', renderIpm], ['programs', 'Programs', lib('ipm')]] },
  office: { title: 'Office', tabs: [
    ['sell', 'Sell', renderPrices], ['buy', 'Buy', renderPurchasing], ['management', 'Farm management', lib('office')]] },
  maintenance: { title: 'Maintenance', tabs: [
    ['equipment', 'Equipment', renderMaintenance], ['preventive', 'Preventive maintenance', lib('maintenance')]] },
  farm: { title: 'Farm setup', tabs: [['zones', 'Zones & positions', renderFarm], ['people', 'People', renderPeople]] },
  units: { title: 'All FarmBoxes', tabs: [['all', 'All FarmBoxes', renderNetwork]] },
};
// Tabs only some people may open (0092): People is for the unit's Admin and Farm manager,
// the franchisee's admin and the franchisor. The database asks the same question
// (app.may_manage_people), so hiding the tab is a courtesy, not the lock.
function mayManagePeople() {
  if (!farm) return false;
  return myRoles.some(r => r.role === 'franchisor_admin'
    || (r.role === 'franchisee_admin' && r.org_id && r.org_id === farm.org_id)
    || (r.farm_id === farm.id && (r.role === 'farm_admin' || r.role === 'farm_manager')));
}
const TAB_GATE = { 'farm/people': mayManagePeople };
const tabsOf = sec => SECTIONS[sec].tabs.filter(([key]) => !TAB_GATE[`${sec}/${key}`] || TAB_GATE[`${sec}/${key}`]());

const MOVED = {
  crops: 'grow/planner', cropdb: 'grow/library', procedures: 'grow/routines',
  prices: 'office/sell', purchasing: 'office/buy', issues: 'dashboard/issues', reports: 'dashboard/reports',
  people: 'farm/people', harvest: 'grow/harvest',
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
  warmed.clear();   // the next person on this tab gets their own offline copies
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
    farms,
    farmId: farm?.id,
    switchFarm,
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
    'select=id,name,code,status,org_id&status=in.(active,setup)&order=name');
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
      `select=role,farm_id,org_id&user_id=eq.${myUserId}&active=is.true`);
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
  location.hash = '#/dashboard/overview';
  paintMyRole().then(() => { route(); warm(); });
}

$('farmPick').addEventListener('change', e => {
  farm = farms.find(f => f.id === e.target.value) || farm;
  pref.set(FARM_KEY, farm.id);
  paintMyRole().then(() => { route(); warm(); });
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
    ['labour_week', { ...p, p_week: defaultWeek() }], ['labour_week', { ...p, p_week: nextWeek() }], ['crop_map', p],
    ['crop_library', p], ['procedures', p],
    ['maintenance', p], ['purchasing', p], ['price_table', p], ['market_trends', p],
    ['issues', { ...p, p_include_closed: false }], ['ipm', p], ['reports', { ...p, ...reportRange() }],
    ['harvest_overview', { ...p, ...harvestRange() }],
    ['farm_market', p],
  ];
  if (mayManagePeople()) calls.push(['people', p], ['family_tree', p]);
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
// #/section/tab. An old address is rewritten in place, so a bookmark or a
// link in an e-mail keeps working.
function currentRoute() {
  const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
  let sec = parts[0] || 'dashboard', tab = parts[1] || '';
  if (MOVED[sec]) { [sec, tab] = MOVED[sec].split('/'); }
  if (!SECTIONS[sec]) { sec = 'dashboard'; tab = ''; }
  const tabs = tabsOf(sec);
  const t = tabs.find(x => x[0] === tab) || tabs[0];
  return { sec, tab: t };
}

function paintTabs(sec, active) {
  const nav = $('secTabs');
  nav.textContent = '';
  const tabs = tabsOf(sec);
  nav.hidden = tabs.length < 2;
  nav.setAttribute('aria-label', SECTIONS[sec].title);
  tabs.forEach(([key, label]) => {
    const a = el('a', null, label);
    a.href = `#/${sec}/${key}`;
    if (key === active[0]) a.setAttribute('aria-current', 'page');
    nav.append(a);
  });
}

async function route() {
  const { sec, tab } = currentRoute();
  const wanted = `#/${sec}/${tab[0]}`;
  if (location.hash !== wanted) { history.replaceState(null, '', wanted); }
  document.querySelectorAll('.rail a').forEach(a =>
    a.dataset.route === sec ? a.setAttribute('aria-current', 'page')
                            : a.removeAttribute('aria-current'));
  const title = SECTIONS[sec].title;
  document.title = `${tab[1] === title ? title : tab[1] + ' · ' + title} · FarmBox Console`;
  paintTabs(sec, tab);

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
    await tab[2](page, farm, { switchFarm, reloadFarms: loadFarms });
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
    // Available systems and media, before any page draws a system or a medium
    await Promise.all([loadCatalog(), loadFamilies()]);
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
