// Boot, sign-in, farm switcher, router. Everything else is a page module.
import { getSession, signIn, signOut, me, select } from './api.js';
import { el, toast, icon, avatar } from './ui.js';
import { renderPeople, roleLabel } from './people.js';
import { renderWeek } from './week.js';
import { renderFarm } from './farm.js';
import { renderCrops } from './crops.js';
import { renderDashboard } from './dashboard.js';
import { renderProcedures } from './procedures.js';
import { renderCropDb } from './cropdb.js';
import { renderMaintenance } from './maintenance.js';
import { renderPurchasing } from './purchasing.js';
import { renderPrices } from './prices.js';
import { renderReports } from './reports.js';
import { renderNetwork } from './network.js';
import { renderIssues } from './issues.js';
import { renderHarvest } from './harvest.js';
import { watchForUpdates, VERSION } from './update.js';

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
let railChoice = null;
try { railChoice = localStorage.getItem(RAIL_KEY); } catch { /* private window */ }

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
  try { localStorage.setItem(RAIL_KEY, railChoice); } catch { /* private window */ }
  paintRail();
});
narrow.addEventListener('change', paintRail);
paintRail();

let farms = [];
let farm = null;
let myUserId = null;

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

$('signout').addEventListener('click', () => {
  signOut();
  location.hash = '';
  showSignin();
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
  const wanted = localStorage.getItem(FARM_KEY);
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
  try { localStorage.setItem(FARM_KEY, farm.id); } catch { /* private window */ }
  paintMyRole();
  location.hash = '#/dashboard';
  route();
}

$('farmPick').addEventListener('change', e => {
  farm = farms.find(f => f.id === e.target.value) || farm;
  try { localStorage.setItem(FARM_KEY, farm.id); } catch { /* private window */ }
  paintMyRole();
  route();
});

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
async function start() {
  $('signin').hidden = true;
  $('shell').hidden = false;
  try {
    const user = await me();
    myUserId = user.id;
    const name = user.user_metadata?.name || user.user_metadata?.full_name ||
      (user.email || '').split('@')[0].replace(/^./, c => c.toUpperCase());
    $('whoName').textContent = name;
    $('who').textContent = user.email || '';
    $('meAvatar').textContent = '';
    $('meAvatar').append(avatar({ id: user.id, name }));
    const v = document.getElementById('version');
    if (v) v.textContent = 'v' + VERSION;
    await loadFarms();
    await paintMyRole();
    if (!location.hash) location.hash = '#/dashboard';
    await route();
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
