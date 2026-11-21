// Boot, sign-in, farm switcher, router. Everything else is a page module.
import { getSession, signIn, signOut, me, select, rpc,
         connection, onConnection, newPage, reconnect, pruneData } from './api.js';
import { el, toast, icon, avatar, pref, setPhotos, loading, setFarmTz, setMyRoles } from './ui.js';
import { roleLabel } from './people.js';
import { renderTeam } from './team.js';
import { renderWeek, defaultWeek, nextWeek } from './week.js';
import { renderFarm, holidayRange } from './farm.js';
import { renderCrops } from './crops.js';
import { renderDashboard, calendarRange } from './dashboard.js';
import { renderProcedures } from './procedures.js';
import { renderCropDb } from './cropdb.js';
import { renderMaintenance } from './maintenance.js';
import { renderPurchasing, renderStock } from './purchasing.js';
import { renderPrices } from './prices.js';
import { renderReports, reportRange } from './reports.js';
import { renderNetwork } from './network.js';
import { renderIssues } from './issues.js';
import { renderOperations } from './operations.js';
import { renderFeedback } from './feedback.js';
import { renderScouting } from './scouting.js';
import { renderIpmPrograms, renderIpmProducts } from './treatments.js';
import { apiBusy } from './api.js';
import { renderHarvest, harvestRange } from './harvest.js';
import { watchForUpdates, VERSION, updateProgress, finishUpdate, checkForUpdate, updateNow } from './update.js';
import { forgetPass } from './cameras.js';
import { timelineRange } from './timeline.js';
import { renderOrders } from './orders.js';
import { renderCustomers } from './customers.js';
import { renderYield, yieldRange } from './yield.js';
import { hoursRange } from './hours.js';
import { renderMoney, moneyRange } from './money.js';
import { renderGallery } from './gallery.js';
import { renderForecast } from './forecast.js';
import { renderValidation } from './validation.js';
import { renderBaskets, basketArgs } from './baskets.js';
import { renderFarmnet, renderHeatmap, renderGrowth, renderCounting, renderDevices } from './connect.js';
import { drop3d } from './farmnet3d.js';
import { renderFnOverview, renderFnIrrigation, renderFnMixing, renderFnClimate, renderFnSensors, renderFnAlarms, renderFnCommands, forgetFarmnet } from './farmnet.js';
import { initAssistant, assistantFarmChanged, forgetAssistant, assistantReady, assistantRouteChanged } from './assistant.js';
import { initStrip, stripRouteChanged, forgetStrip } from './op-strip.js';
import { liveOpen } from './live.js';
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

// The rail is icons only since 19 Nov 2026 (the menu folded to them before); the name shows on hover.
// The zoom of the top bar went with it: the browser's own zoom (Ctrl + / −) does the same.
pref.set('fbc_rail', null); pref.set('fbc_zoom', null);

// the person's menu, on their picture at the foot of the rail: who, which role, Sign out
const meMenu = $('meMenu'), meBtn = $('meBtn');
function setMeMenu(open) { meMenu.hidden = !open; meBtn.setAttribute('aria-expanded', String(open)); }
meBtn.addEventListener('click', e => { e.stopPropagation(); setMeMenu(meMenu.hidden); });
document.addEventListener('click', e => { if (!meMenu.hidden && !meMenu.contains(e.target)) setMeMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !meMenu.hidden) { setMeMenu(false); meBtn.focus(); } });

let farms = [];          // every unit this account may open
let choices = [];        // what the switcher offers: a site for sister units (0.7.158), else the unit
let farm = null;         // the site or the unit open now
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
  // the recurring pest rounds (sticky traps, scouting) are crop routines too (owner, 24 Sept 2026);
  // a Pest & disease treatment started by a person stays under IPM programs only
  // Grow › Procedures (0.7.109): the routines and the crop-plan procedures in one list, filtered by how they repeat
  grow: { title: 'Procedures', keep: p => p.family === 'Agriculture'
      && (p.category !== 'Pest & disease' || p.frequency === 'Routine'),
    blurb: 'All the growing work: the rounds on a schedule (irrigation, nutrients and water, climate, sanitation, scouting), what each crop needs with the crop plan (sowing, transplanting, harvesting, clearing), and what is done when needed.' },
  ipm: { title: 'Pest & disease procedures', keep: p => p.category === 'Pest & disease',
    blurb: 'Scouting, the sticky-trap round, treatments: every Pest & disease procedure.' },
  office: { title: 'Farm management', keep: p => p.family === 'Office',
    blurb: 'The office procedures: admin, orders and deliveries, the weekend remote check.' },
  maintenance: { title: 'Preventive maintenance', keep: p => p.family === 'Maintenance',
    blurb: 'The maintenance procedures the equipment rules call, at their own interval.' },
};
const lib = key => (c, f, ctx) => renderProcedures(c, f, LIB[key]);

const SECTIONS = {
  dashboard: { title: 'Dashboard', tabs: [
    ['overview', 'Overview', renderDashboard], ['yield', 'Yield', renderYield], ['issues', 'Issues', renderIssues], ['feedback', 'Feedback', renderFeedback], ['reports', 'Reports', renderReports],
    ['timeline', 'Timeline', renderOperations]] },   // the operation log (0286, console 0.19.00; operations.js — timeline.js is the crop planner's)   // Feedback (0.7.186, migration 0189): drawn once for a site, its rows say the unit
  week: { title: 'Tasks', tabs: [['board', 'Tasks', renderWeek], ['team', 'Team', renderTeam]] },
  grow: { title: 'Grow', tabs: [
    ['planner', 'Crop planner', renderCrops], ['library', 'Crop library', renderCropDb], ['procedures', 'Procedures', lib('grow')],
    ['forecast', 'Forecast review', renderForecast], ['harvest', 'Harvest', renderHarvest], ['validation', 'Field validation', renderValidation]] },
  // Pest & diseases (0096): the daily scouting report first, then the traps and the programs; the address stays #/ipm
  // Pest & diseases (0.7.101): one page — the dashboard, the open cases, the reports by date → zone → photo —
  // and the procedures; the trap setup is behind the page's "Traps…" button
  // The page is called Scouting since 12 Oct 2026 (was Pest & diseases); the procedure category keeps its name
  ipm: { title: 'Scouting', tabs: [['scouting', 'Scouting', renderScouting], ['library', 'IPM programs', renderIpmPrograms], ['products', 'Products', renderIpmProducts], ['programs', 'Procedures', lib('ipm')]] },   // the IPM library (0197, 0.7.199)   // the Traps tab is in the report (0.7.174), the robot too (0.7.184)
  office: { title: 'Office', tabs: [
    // Sell is the basket planner since 0.7.141; the market prices are Market
    ['market', 'Market', renderPrices], ['sell', 'Sell', renderBaskets], ['orders', 'Orders', renderOrders], ['customers', 'Customers', renderCustomers], ['buy', 'Buy', renderPurchasing], ['stock', 'Stock', renderStock], ['money', 'Money', renderMoney], ['gallery', 'Gallery', renderGallery], ['management', 'Farm management', lib('office')]] },
  maintenance: { title: 'Maintenance', tabs: [
    ['equipment', 'Equipment', renderMaintenance], ['preventive', 'Preventive maintenance', lib('maintenance')]] },
  // Connections (0.7.142, migration 0130): FarmNet, sensors and the fixed cameras, fed by the ingest endpoint
  connect: { title: 'Connections', tabs: [
    ['farmnet', 'FarmNet & sensors', renderFarmnet], ['heatmap', 'Heat map', renderHeatmap], ['growth', 'Crop growth', renderGrowth],
    ['counting', 'Counting', renderCounting], ['devices', 'Devices & API', renderDevices]] },
  // FarmNet (0272, 5 Nov 2026): the controller itself, live, through the edge function farmnet; its admin and farm manager send commands
  farmnet: { title: 'FarmNet', tabs: [
    ['overview', 'Overview', renderFnOverview], ['irrigation', 'Irrigation', renderFnIrrigation], ['mixing', 'Mixing', renderFnMixing],
    ['climate', 'Climate', renderFnClimate], ['sensors', 'Sensors', renderFnSensors], ['alarms', 'Alarms', renderFnAlarms], ['commands', 'Commands', renderFnCommands]] },
  farm: { title: 'Farm setup', tabs: [['zones', 'Zones & positions', renderFarm]] },
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
const mayMoney = () => !!farm && (mayManagePeople() || myRoles.some(r => r.farm_id === farm.id && r.role === 'office'));
const TAB_GATE = { 'office/money': mayMoney };
const tabsOf = sec => SECTIONS[sec].tabs.filter(([key]) => !TAB_GATE[`${sec}/${key}`] || TAB_GATE[`${sec}/${key}`]());

// ── one site, two units (0.7.158) ───────────────────────────────────────────
// Sister units (farm.sister_group) are ONE site in the switcher — "FarmLab + FarmBox1".
// The pages the units share (Tasks, Office, People, the libraries) are drawn once for the
// site; the pages that differ carry a unit selector: an overview page opens on Both — each
// unit's view in turn, under its heading in the unit's colour — a working page on one unit.
// Nothing is merged in the database: the units keep their zones, codes and settings.
const PAGE_KIND = {
  'dashboard/overview': 'overview', 'dashboard/yield': 'overview', 'dashboard/issues': 'overview', 'dashboard/reports': 'overview',
  'grow/forecast': 'overview', 'grow/harvest': 'overview', 'grow/validation': 'overview',
  'ipm/scouting': 'overview', 'office/money': 'overview', 'office/orders': 'overview',
  'connect/farmnet': 'overview', 'connect/heatmap': 'overview', 'connect/growth': 'overview', 'connect/counting': 'overview',
  'grow/planner': 'work', 'maintenance/equipment': 'work', 'dashboard/timeline': 'work', 'connect/devices': 'work', 'farm/zones': 'work',
  // FarmNet: one controller per unit (the farm's code names its secrets), so one unit at a time
  'farmnet/overview': 'work', 'farmnet/irrigation': 'work', 'farmnet/mixing': 'work', 'farmnet/climate': 'work',
  'farmnet/sensors': 'work', 'farmnet/alarms': 'work', 'farmnet/commands': 'work',
};
// Both loads the page's module once per unit (./x.js?unit=…): each copy keeps its own state
const PAGE_MOD = {
  'dashboard/overview': ['./dashboard.js', 'renderDashboard'], 'dashboard/yield': ['./yield.js', 'renderYield'],
  'dashboard/issues': ['./issues.js', 'renderIssues'], 'dashboard/reports': ['./reports.js', 'renderReports'],
  'grow/forecast': ['./forecast.js', 'renderForecast'], 'grow/harvest': ['./harvest.js', 'renderHarvest'],
  'grow/validation': ['./validation.js', 'renderValidation'], 'ipm/scouting': ['./scouting.js', 'renderScouting'],
  'office/money': ['./money.js', 'renderMoney'], 'office/orders': ['./orders.js', 'renderOrders'],
  'connect/farmnet': ['./connect.js', 'renderFarmnet'], 'connect/heatmap': ['./connect.js', 'renderHeatmap'],
  'connect/growth': ['./connect.js', 'renderGrowth'], 'connect/counting': ['./connect.js', 'renderCounting'],
};
const unitsOf = f => f?.site ? f.units : f ? [f] : [];

// ── which units, in the tool bar (19 Nov 2026) ───────────────────────────────────
// One choice for every page of the site, kept on this device (it was one per page, a bar on each page, until 19 Nov 2026).
// `sel` is the units switched on — an overview page shows each of them in turn (Both when they are all on); `focus` is
// the one a working page opens (the planner, FarmNet, Farm setup), the last one pressed. A page both units share
// (Tasks, Office, the libraries) shows the buttons greyed: it is the same for all of them.
// FarmNet keeps a unit of its own (owner, 5 Nov 2026, again 19 Nov 2026): one controller per unit, and only Box1 has
// one — the site's choice opened FarmNet on Lab, "no controller", and FarmNet looked gone. Its tabs share
// `fbc_unit_farmnet` (the key from before the new shell, so the unit chosen then is kept); pressing a unit there
// changes FarmNet only.
const OWN_FOCUS = { farmnet: 'fbc_unit_farmnet' };
const shortName = u => (u.name || u.code || '').replace(/^farm(?=[a-z])/i, '') || u.name;
function unitState(site, sec = null) {
  const ids = site.units.map(u => u.id);
  let st = null;
  try { st = JSON.parse(pref.get('fbc_units_' + site.id) || 'null'); } catch { /* none */ }
  let sel = (st?.sel || []).filter(i => ids.includes(i));
  // a unit that joined the site after the choice was kept comes on (it was left off until pressed)
  if (st?.known) sel = ids.filter(i => sel.includes(i) || !st.known.includes(i));
  if (!sel.length) sel = ids.slice();
  const focus = sel.includes(st?.focus) ? st.focus : sel[0];
  const own = OWN_FOCUS[sec] && pref.get(OWN_FOCUS[sec]);
  if (OWN_FOCUS[sec]) return { sel, focus: ids.includes(own) ? own : focus, own: true };
  return { sel, focus };
}
const keepUnitState = (site, st) => pref.set('fbc_units_' + site.id, JSON.stringify({ ...st, known: site.units.map(u => u.id) }));

function paintUnitPick(kind, sec) {
  const box = $('unitPick');
  box.textContent = '';
  box.hidden = !farm?.site;
  if (!farm?.site) return;
  const site = farm, st = unitState(site, sec);
  box.classList.toggle('shared', !kind);
  box.title = !kind ? 'This page is the same for every unit of the site'
            : kind === 'work' ? 'This page shows one unit at a time' : 'Lab, Box1 or both';
  // one choice among the units and Both — nothing is switched on or off one by one any more (19 Nov 2026).
  // A working page shows one unit at a time: Both is greyed there.
  const all = site.units.map(u => u.id);
  const both = st.sel.length === all.length;
  site.units.forEach(u => {
    const b = el('button', 'unit-btn'); b.type = 'button';
    const d = el('span', 'unit-dot'); d.style.background = u.badge_colour || 'var(--text-muted)';
    b.append(d, el('span', null, shortName(u)));
    b.title = u.name;
    const on = kind === 'work' ? u.id === st.focus : !both && st.sel.length === 1 && st.sel[0] === u.id;
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !kind;
    b.onclick = () => {
      let { sel, focus, own } = unitState(site, sec);
      if (kind === 'work' && own) {
        if (u.id !== focus) { pref.set(OWN_FOCUS[sec], u.id); route(); }
        return;
      }
      if (kind === 'work') {
        if (u.id === focus) return;
        focus = u.id;
        if (!sel.includes(u.id)) sel = [u.id];
      } else {
        if (sel.length === 1 && sel[0] === u.id) return;
        sel = [u.id]; focus = u.id;
      }
      keepUnitState(site, { sel, focus });
      route();
    };
    box.append(b);
  });
  const bb = el('button', 'unit-btn'); bb.type = 'button';
  bb.append(el('span', null, all.length > 2 ? 'All' : 'Both'));
  bb.title = 'Every unit of the site, each in turn';
  bb.setAttribute('aria-pressed', String(kind !== 'work' && both));
  bb.disabled = !kind || kind === 'work';
  bb.onclick = () => {
    const { sel, focus } = unitState(site, sec);
    if (sel.length === all.length) return;
    keepUnitState(site, { sel: all, focus });
    route();
  };
  box.append(bb);
}

async function renderUnits(page, site, key, tab, kind) {
  const { sel, focus } = unitState(site, key.split('/')[0]);
  page.textContent = '';
  const ctx = { switchFarm, reloadFarms: loadFarms, site };
  if (kind === 'work') return tab[2](page, site.units.find(u => u.id === focus), ctx);
  const units = site.units.filter(u => sel.includes(u.id));
  if (units.length === 1) return tab[2](page, units[0], ctx);
  const [path, fn] = PAGE_MOD[key];
  await Promise.all(units.map(async u => {
    const block = el('section', 'unit-block');
    block.style.setProperty('--u', u.badge_colour || 'var(--text-muted)');
    block.dataset.unit = shortName(u);
    const head = el('div', 'unit-head');
    head.append(el('span', 'unit-badge', u.badge_label || u.code), el('b', null, u.name));
    const inner = el('div', 'unit-inner');
    block.append(head, inner);
    page.append(block);
    // the ?unit= URL is new to this visit, so it comes from the network: after a release, the new page module into
    // this old page, whose ui.js/api.js may lack what it imports (review 16 Nov 2026) — offer the update, not a fault
    let m;
    try { m = await import(`${path}?unit=${u.id}`); }
    catch (err) { inner.textContent = ''; inner.append(updateOffer(err)); return; }
    try { await m[fn](inner, u, ctx); }
    catch (err) { inner.textContent = ''; inner.append(el('div', 'note bad', err.message)); }
  }));
}

// ── the page's actions, in the tool bar (19 Nov 2026) ─────────────────────────────
// A page still builds its head with pageHead(title, blurb, ...buttons) (ui.js); the buttons are lifted from it into
// the row under the tabs, so every page has its actions in the same place. Watching the page instead of asking each
// page to call something: a page that draws its head again later (after a save, a filter) is followed by itself.
// With several units on, each unit's buttons come under its own name.
let actsQueued = false;
let lastAiKey = '';   // the page and units the assistant's chips were last drawn for
function collectActions() {
  actsQueued = false;
  const groups = [], bar = [];
  $('page').querySelectorAll('.page-head').forEach(h => {
    const acts = h._acts;
    // a button marked tb-refresh goes to the tool bar, before the unit buttons (FarmNet's Refresh, no text); remembered on
    // the head, because once lifted it is no longer among the head's buttons
    if (acts && !h._bar) { const l = [...acts.querySelectorAll(':scope > .tb-refresh')]; if (l.length) h._bar = l; }
    if (h._bar) bar.push(...h._bar);
    if (!acts || !acts.childElementCount) return;
    const g = el('div', 'act-group');
    const blk = h.closest('.unit-block');
    if (blk) {
      const tag = el('span', 'act-unit', blk.dataset.unit || '');
      tag.style.setProperty('--u', blk.style.getPropertyValue('--u'));
      g.append(tag);
    }
    g.append(acts);
    groups.push(g);
  });
  $('pageActions').replaceChildren(...groups);
  $('tbRefresh').replaceChildren(...bar);
  paintActionsRow();
}
const paintActionsRow = () => { $('actions').hidden = !$('pageActions').childElementCount && $('upd').hidden; };
new MutationObserver(() => {
  if (actsQueued) return;
  actsQueued = true;
  queueMicrotask(collectActions);
}).observe($('page'), { childList: true, subtree: true });
// the head's height as --head-h, for what is sized to the window under it (the planner board, the Tasks people column)
new ResizeObserver(() => document.documentElement.style.setProperty('--head-h', Math.round($('head').getBoundingClientRect().height) + 'px')).observe($('head'));
// the update slot shares the row: the row shows when either has something
new MutationObserver(paintActionsRow).observe($('upd'), { attributes: true, attributeFilter: ['hidden'] });

function updateOffer(err) {
  const n = el('div', 'note bad');
  n.append(el('div', null, 'This view could not load: a newer version of the console is probably out. Update to see it.'),
           el('div', 'hint', err?.message || String(err)));
  const go = el('button', 'btn btn-primary', 'Update now');
  go.type = 'button';
  go.onclick = async () => {
    go.disabled = true;
    const latest = (await checkForUpdate())?.version;
    if (latest && latest !== VERSION) updateNow(latest); else location.reload();
  };
  n.append(go);
  return n;
}

const MOVED = {
  crops: 'grow/planner', cropdb: 'grow/library', procedures: 'grow/procedures',
  prices: 'office/market', purchasing: 'office/buy', issues: 'dashboard/issues', reports: 'dashboard/reports',
  people: 'week/team', harvest: 'grow/harvest',
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

// the assistant's conversations stay with the person who had them (they may hold Money or People answers)
function forgetConversations() {
  // the kept copies first: with the panel open, forgetAssistant() repaints at once and read the conversation just
  // forgotten back from the storage — it stayed on screen for the next person (review 13 Oct 2026)
  // fbc_ai_… the per-page copies before 0.17.00, fbc_aic_… the one conversation per person and farm since (verifier, 21 Nov 2026);
  // the device's own settings (panel open, read all answers) stay
  try { Object.keys(localStorage).filter(k => (k.startsWith('fbc_ai_') || k.startsWith('fbc_aic_')) && k !== 'fbc_ai_open' && k !== 'fbc_ai_read_all').forEach(k => localStorage.removeItem(k)); }
  catch { /* storage off: nothing kept either */ }
  forgetAssistant();
  try { forgetStrip(); } catch (e) { console.warn('history strip', e); }
}
// the next person on this tab starts from nothing (review 3 Oct 2026): with `booted` still true from
// the last person, a start that failed on the network was never retried and a reconnect drew the
// last person's farm with the new token
function resetState() {
  booted = false; farm = null; farms = []; choices = []; myRoles = []; setMyRoles([]);
  startError = null; startRetried = false; bootBar = null;
  liveOpen(null);
  $('unitPick').hidden = true; $('pageActions').textContent = '';
  setMeMenu(false);   // its Sign out is inside it: the next person found it open with their name (verifier, 19 Nov 2026)
  lastAiKey = '';
}
// Every way a session ends goes through here (review 16 Nov 2026: each path cleared a different part): Sign out, a
// session refused at start or in the middle of the day, a sign-out or another person's sign-in in another tab.
function endSession(message) {
  warmed.clear();   // the next person on this tab gets their own offline copies
  forgetConversations();
  drop3d();
  forgetFarmnet();  // FarmNet's kept answers are the last person's too
  forgetPass();    // the camera's pass was the last person's
  signOut();
  resetState();
  location.hash = '';
  showSignin(message);
}
function doSignOut() { endSession(); }
$('signout').addEventListener('click', doSignOut);
// signed in in another tab while this one shows the form (api.js): this one opens too
addEventListener('fbc:session-started', () => { if (!$('signin').hidden && getSession()) start(); });
// a session refused in the middle of the day: back to the form, the offline copies cleared (0.7.112)
// a page shows the copy kept on this computer because the fresh read was refused (api.js openFast)
let staleShown = 0;
addEventListener('fbc:stale', e => {
  if (Date.now() - staleShown < 10_000) return;       // one notice for a page's several reads
  staleShown = Date.now();
  toast('Showing the copy kept on this computer — the fresh read failed: ' + e.detail, 'bad');
});
addEventListener('fbc:session-ended', () => {
  if ($('shell').hidden) return;
  endSession('Your session has ended. Sign in again.');
});

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
    signOut: doSignOut,
    refresh: () => { if (farm) route(); },
    farms: choices,        // the switcher's list: sister units as one site (0.7.162)
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
    'select=id,name,code,status,org_id,operating_days,sister_group,badge_label,badge_colour,created_at,currency,nursery_default,timezone&status=in.(active,setup)&order=name');
  // sister units are one site (0.7.158): oldest first, its id the home unit's
  const groups = new Map();
  farms.filter(f => f.sister_group).forEach(f => { if (!groups.has(f.sister_group)) groups.set(f.sister_group, []); groups.get(f.sister_group).push(f); });
  const sites = [...groups.values()].filter(g => g.length > 1).map(g => {
    const units = g.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return { ...units[0], name: units.map(u => u.name).join(' + '), code: units.map(u => u.code).join('+'), site: true, units };
  });
  const inSite = new Set(sites.flatMap(s => s.units.map(u => u.id)));
  choices = [...sites, ...farms.filter(f => !inSite.has(f.id))].sort((a, b) => a.name.localeCompare(b.name));
  // this tab's own FarmBox first, when it has one: the list is read again after some saves (Farm setup, a new
  // unit), and the kept choice may by then be another tab's — the page used to follow it (13 Oct 2026)
  const wanted = farm?.id || pref.get(FARM_KEY);
  farm = choices.find(f => f.id === wanted) || sites.find(s => s.units.some(u => u.id === wanted)) || choices[0] || null;
  // no picker in the top bar any more (19 Nov 2026): another FarmBox is chosen on All FarmBoxes (or in Settings),
  // so the rail shows that page to whoever has more than one to choose from
  paintUnitsLink();
}
function paintUnitsLink() {
  const show = choices.length > 1 || myRoles.some(r => r.role === 'franchisor_admin');
  $('unitsLink').hidden = !show; $('franchisorSep').hidden = !show;
}

// What am I here? Franchisor first — it outranks anything farm-level.
const readMyRoles = () => select('membership', `select=role,farm_id,org_id&user_id=eq.${myUserId}&active=is.true`);
// pending: the rows already asked for (the start-up reads them beside the FarmBoxes); the pill needs the farm either way
async function paintMyRole(pending) {
  const pill = $('envPill');
  try {
    const rows = await (pending || readMyRoles());
    myRoles = rows;
    setMyRoles(rows);
    const franchisor = rows.some(r => r.role === 'franchisor_admin');
    const here = rows.find(r => r.farm_id === farm?.id);
    pill.textContent = franchisor ? 'Franchisor admin'
                     : here ? roleLabel(here.role) + ' here'
                     : 'No role here';
    pill.className = 'pill' + (franchisor || here ? ' ok' : ' warn');
    pill.hidden = false;
    $('meBtn').title = $('whoName').textContent + ' · ' + pill.textContent;
  } catch { myRoles = []; setMyRoles([]); pill.hidden = true; }
  paintUnitsLink();   // never the previous farm's or person's roles
}

// Switching FarmBox from anywhere: the picker, or a row on All FarmBoxes.
function switchFarm(id) {
  const next = choices.find(f => f.id === id) || choices.find(f => f.site && f.units.some(u => u.id === id));
  if (!next) return;
  farm = next;
  pref.set(FARM_KEY, farm.id);
  // no hashchange (0.7.162): it drew the dashboard once with the old unit's roles before paintMyRole answered
  history.replaceState(null, '', '#/dashboard/overview');
  paintMyRole().then(() => { route(); warm(); assistantFarmChanged(); });
}


// ── connected / offline ────────────────────────────────────────────────────
// At the foot of the rail, always (top right until 19 Nov 2026): a person has to know whether what is on screen is live
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
    n.className = 'rail-btn net ' +
      (phase === 'online' ? 'is-online' : phase === 'connecting' ? 'is-connecting' : 'warn');
    const word = phase === 'online' ? 'Connected' : phase === 'connecting' ? 'Connecting…' : 'Offline';
    n.append(icon(phase === 'offline' ? 'wifiOff' : 'wifi'), el('span', 'sr-only', word));
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

// Redraw only after the console really was offline (or showed a kept copy): one failed request
// that the first health check answered used to toast "Connected again" and redraw the page,
// losing its scroll and anything half typed on it (review 3 Oct 2026).
let wasOffline = !connection().online && connection().phase === 'offline';
onConnection(state => {
  paintConnection(state);
  if (state.phase === 'offline' || state.savedAt != null) wasOffline = true;
  if (state.online && wasOffline) {
    wasOffline = false;
    // Back: replace the copy on screen with the real thing, or finish a start
    // that the lost signal interrupted.
    toast('Connected again', 'ok');
    if (!booted) { if (getSession()) start(); }
    else route();
  }
});

// Read every page's data ahead, once per farm per visit, so a page never
// opened today still opens when the signal drops. The same calls with the same
// arguments as the pages make, or the copy would sit under a different key.
// Drawers (a crop's or a procedure's detail) are read only when opened.
const warmed = new Set();
async function warm() {
  if (!farm || !connection().online) { finishUpdate(); return; }
  // a site: each unit's copies, the home unit first (0.7.158)
  const ids = unitsOf(farm).map(u => u.id).filter(i => !warmed.has(i));
  if (!ids.length) { finishUpdate(); return; }
  await new Promise(r => setTimeout(r, 4000));      // well after the page itself (0.7.218; was 1.2 s)
  for (const id of ids) await warmOne(id);
  finishUpdate();
}
async function warmOne(id) {
  warmed.add(id);
  const p = { p_farm: id };
  const calls = [
    ['dashboard', p], ['crop_calendar', { ...p, ...calendarRange() }],
    ['labour_week', { ...p, p_week: defaultWeek() }], ['labour_week', { ...p, p_week: nextWeek() }], ['crop_map', p],
    ['crop_timeline', { ...p, ...timelineRange() }], ['orders', { ...p, p_include_closed: false }], ['basket_plan', basketArgs(id)], ['connections', p], ['customers', { ...p, p_inactive: false }], ['yield_dashboard', { ...p, ...yieldRange() }], ['labour_hours', { ...p, ...hoursRange() }], ['forecast_review', p], ['field_corrections', { ...p, p_status: null }], ['to_decide', p],
    ['crop_library', p], ['procedures', p],
    ['maintenance', p], ['purchasing', p], ['seedling_orders', p], ['price_table', p], ['market_trends', p],
    ['issues', { ...p, p_include_closed: false }], ['task_feedback_list', { ...p, p_limit: 500 }], ['ipm', p], ['pest_catalog', {}], ['cases', { ...p, p_include_closed: false }], ['pest_overview', p], ['trap_map', p], ['zone_opinions', p], ['ipm_library', p],
    ['scouting_dates', { ...p, p_before: null, p_limit: 21 }], ['robot_scouting', { ...p, p_days: 90 }], ['pest_dot', p], ['reports', { ...p, ...reportRange() }],
    ['harvest_overview', { ...p, ...harvestRange() }],
    ['farm_market', p], ['farm_holidays', { ...p, ...holidayRange() }],
  ];
  calls.push(['team_setup', p], ['people', p], ['family_tree', p]);   // Tasks › Team (its hours are read above)
  if (mayMoney()) calls.push(['money', { ...p, ...moneyRange() }]);
  if (myRoles.some(r => r.role === 'franchisor_admin')) calls.push(['farm_network', {}]);
  // One at a time, and only while the page asks for nothing itself (0.7.218, owner 4 Oct 2026: "too long to open old
  // reports", statement timeouts). 0.7.107 ran four at a time, for each unit of a site: some thirty heavy reads a
  // unit (the planner, the baskets, the week) in the same seconds as the page's own — the database server has little
  // processor, and calls that take half a second alone were cancelled at eight. The pre-load is for offline; it can wait.
  let done = 0, lost = false;
  const idle = async () => { let quiet = 0; while (quiet < 2) { await new Promise(r => setTimeout(r, 200)); quiet = apiBusy() ? 0 : quiet + 1; } };
  for (const [name, args] of calls) {
    if (!connection().online) { lost = true; break; }
    await idle();
    try { await rpc(name, args); } catch { /* the page will say so if it matters */ }
    updateProgress(++done, calls.length);
  }
  if (lost) warmed.delete(id);
}

// ── routing ────────────────────────────────────────────────────────────────
// #/section/tab. An old address is rewritten in place, so a bookmark or a
// link in an e-mail keeps working.
function currentRoute() {
  const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
  let sec = parts[0] || 'dashboard', tab = parts[1] || '';
  if (MOVED[sec]) { [sec, tab] = MOVED[sec].split('/'); }
  if (sec === 'grow' && tab === 'routines') tab = 'procedures';   // Routines became Procedures (0.7.109)
  // People and Hours are one page, Tasks › Team (0.7.222)
  if (sec === 'farm' && tab === 'people') { sec = 'week'; tab = 'team'; }
  if (sec === 'week' && tab === 'hours') tab = 'team';
  if (!SECTIONS[sec]) { sec = 'dashboard'; tab = ''; }
  const tabs = tabsOf(sec);
  const t = tabs.find(x => x[0] === tab) || tabs[0];
  return { sec, tab: t };
}

function paintTabs(sec, active) {
  const nav = $('secTabs');
  nav.textContent = '';
  const tabs = tabsOf(sec);
  nav.hidden = false;      // one tab too: since 19 Nov 2026 the tab is the page's name (the pages have no title of their own)
  nav.setAttribute('aria-label', SECTIONS[sec].title);
  tabs.forEach(([key, label]) => {
    const a = el('a', null, label);
    a.href = `#/${sec}/${key}`;
    if (key === active[0]) a.setAttribute('aria-current', 'page');
    nav.append(a);
  });
}

// the side menu's dot on Pest & diseases (0099): the worst open case or trap on the farm
async function paintPestDot() {
  const a = document.querySelector('.rail a[data-route="ipm"]');
  if (!a || !farm) return;
  // a site: the worst of its units (0.7.158)
  const rank = { red: 3, orange: 2, green: 1 };
  const asked = farm;
  const ds = await Promise.all(unitsOf(farm).map(u => rpc('pest_dot', { p_farm: u.id }).catch(() => null)));
  if (farm !== asked) return;              // switched FarmBox meanwhile: that farm's dot is not this one's
  const d = ds.reduce((a, x) => (rank[x] || 0) > (rank[a] || 0) ? x : a, null);
  a.querySelector('.rail-dot')?.remove();
  if (d) {
    const s = el('span', 'rail-dot ' + d);
    s.title = { red: 'A severe case, or a trap over the limit', orange: 'A case open, or a trap on watch', green: 'Improving, or resolved recently' }[d];
    a.append(s);
  }
}

async function route() {
  setFarmTz(farm?.timezone);                 // every page's "today" is the farm's (ui.js farmToday)
  // the site's live channel, on every page (review 13 Oct 2026): it used to open only once the Tasks board had been
  // drawn, so a change made on Team or the Crop planner before that told no phone, and after a switch of FarmBox the
  // console went on speaking on the channel of the site it had left
  liveOpen(booted && farm ? farm.id : null);
  paintPestDot();
  const { sec, tab } = currentRoute();
  const wanted = `#/${sec}/${tab[0]}`;
  if (location.hash !== wanted) { history.replaceState(null, '', wanted); }
  document.querySelectorAll('.rail a').forEach(a =>
    a.dataset.route === sec ? a.setAttribute('aria-current', 'page')
                            : a.removeAttribute('aria-current'));
  const title = SECTIONS[sec].title;
  document.title = `${tab[1] === title ? title : tab[1] + ' · ' + title} · Naked Heart`;
  paintTabs(sec, tab);
  paintUnitPick(farm?.site ? PAGE_KIND[`${sec}/${tab[0]}`] : null, sec);
  const aiKey = `${sec}/${tab[0]}|${farm?.id || ''}|${farm?.site ? JSON.stringify(unitState(farm, sec)) : ''}`;
  if (booted && aiKey !== lastAiKey) { lastAiKey = aiKey; assistantRouteChanged(); try { stripRouteChanged(); } catch (e) { console.warn('history strip', e); } }   // the history strip under it (0.22.00): it never costs the page

  newPage();
  const page = $('page');
  if (!booted) {
    if (startError) showStartError();
    else { page.textContent = ''; page.append(bootBar || loading('Starting…', 5)); }
    return;
  }
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
  // a fresh box for every visit (0.7.162): an answer still on its way for the page just left finds its box
  // detached and draws nothing — #page itself stays connected, so it used to paint over the new page
  const view = el('div', 'page-view');
  page.replaceChildren(view);
  try {
    const key = `${sec}/${tab[0]}`;
    if (farm.site && PAGE_KIND[key]) await renderUnits(view, farm, key, tab, PAGE_KIND[key]);
    else await tab[2](view, farm, { switchFarm, reloadFarms: loadFarms, site: farm.site ? farm : null });
  } catch (err) {
    if (!view.isConnected) return;         // a page already left: its error is not this page's
    view.replaceChildren(el('div', 'note bad', err.message));
  }
}

window.addEventListener('hashchange', route);

// what the assistant is told about the screen (19 Nov 2026): the page and, on a site, the units switched on
function aiWhere() {
  const { sec, tab } = currentRoute();
  const page = tab[1] === SECTIONS[sec].title ? tab[1] : `${SECTIONS[sec].title} › ${tab[1]}`;
  let units = null, unitIds = null, allUnitIds = null;
  if (farm?.site) {
    const kind = PAGE_KIND[`${sec}/${tab[0]}`], st = unitState(farm, sec);
    const on = kind === 'work' ? [st.focus] : kind ? st.sel : farm.units.map(u => u.id);
    const shown = farm.units.filter(u => on.includes(u.id));
    units = shown.map(u => u.name);
    unitIds = shown.map(u => u.id);   // what the assistant READS: the units on screen (it used to read only the site's first unit, FarmLab)
    allUnitIds = farm.units.map(u => u.id);
  }
  return { page, units, unitIds, allUnitIds };
}

// Say so when a newer console is deployed: an installed tab can sit on an old
// copy of itself for days otherwise.
watchForUpdates();

// the assistant (0.7.122): a band on top since 19 Nov 2026 (a side panel before), one conversation per FarmBox; a change it proposes
// runs only when the person presses Do it, and then the page on screen is drawn again
initAssistant({ farm: () => farm, refresh: () => route(), user: () => myUserId, where: aiWhere });
// the history strip just under the assistant (0.22.00, owner 21 Nov 2026): the operation log as a CAD feature timeline
try { initStrip({ farm: () => farm, user: () => myUserId, where: aiWhere }); } catch (e) { console.warn('history strip', e); }

// ── boot ───────────────────────────────────────────────────────────────────
let booted = false;
// The start-up, step by step (0.7.105): signing in, the FarmBoxes, the role, then the
// page, which carries on with its own bar while it reads.
let bootBar = null;
// one start at a time: the 4 s retry, a reconnect and Try again could each run one
let starting = null;
function start() {
  starting ||= startOnce().finally(() => { starting = null; });
  return starting;
}
async function startOnce() {
  $('signin').hidden = true;
  $('shell').hidden = false;
  bootBar = loading('Signing in…', 8);
  $('page').textContent = '';
  $('page').append(bootBar);
  try {
    const user = await me();
    bootBar.set(25, 'Reading who you are…');
    myUserId = user.id;
    myUser = user;
    const name = user.user_metadata?.name || user.user_metadata?.full_name ||
      (user.email || '').split('@')[0].replace(/^./, c => c.toUpperCase());
    $('whoName').textContent = name;
    $('who').textContent = user.email || '';
    // Everything below needs only who you are, so it is asked at once (21 Nov 2026; one after the other it was six
    // round trips to Frankfurt before the page): your worker row, everyone's pictures, the systems and families, the
    // FarmBoxes, your roles. The face waits for the first two, the role pill for the FarmBoxes (it names the farm).
    bootBar.set(40, 'Reading the systems, task families and your FarmBoxes…');
    // The same face here as on People and the plan: those key on the worker
    // row, so find the signed-in person's. A franchisor admin has none and
    // keeps a face of their own.
    const worker = select('worker', `select=id&user_id=eq.${user.id}&active=is.true&limit=1`)
      .then(mine => { myWorkerId = mine[0]?.id ?? null; }, () => { myWorkerId = null; });
    // everyone's own picture, for every avatar on every page (ui.js setPhotos)
    // … and their colour when they have none: the place at their site (FarmBox 0220); a database before it has no such column
    const photos = select('worker', 'select=id,photo_url,colour_place&order=created_at.asc,id.asc').then(setPhotos)
      .catch(() => select('worker', 'select=id,photo_url&order=created_at.asc,id.asc').then(setPhotos).catch(() => { /* demo faces */ }));
    // Available systems and media, before any page draws a system or a medium
    const lists = Promise.all([loadCatalog().catch(e => console.warn('catalogue', e)), loadFamilies().catch(e => console.warn('families', e))]);
    const roles = readMyRoles();
    roles.catch(() => { /* paintMyRole handles it; this only keeps a start that fails first from an unhandled rejection */ });
    // the others never fail; a failed FarmBox list fails the start as before, once the rest has settled
    const farmList = loadFarms();
    await Promise.all([worker, photos, lists, farmList.catch(() => {})]);
    await farmList;
    $('meAvatar').textContent = '';
    $('meAvatar').append(avatar({ worker_id: myWorkerId, id: user.id, name }));
    const tv = document.getElementById('topVersion');
    if (tv) tv.textContent = 'v' + VERSION;
    bootBar.set(70, 'Checking your role…');
    await paintMyRole(roles);
    bootBar.set(85, 'Opening the page…');
    // replaceState, not location.hash: that queued a hashchange and drew the start page twice
    if (!location.hash) history.replaceState(null, '', '#/' + startPage());
    booted = true;
    assistantReady();       // this person's height of the band on this screen, and their conversation
    bootBar = null;
    await route();
    warm();
    setTimeout(() => pruneData(), 60_000);   // old offline copies out, once the page and warm() are done
  } catch (err) {
    // The server answering "no" about who you are is a dead session: expired or
    // revoked (401), or the account itself deleted (403, "user from sub claim
    // does not exist"). Either way the console must go back to the sign-in
    // form, not sit in an empty shell with a red toast.
    // A request that never reached the server is a lost signal, not a dead
    // session, and must not throw away a good one.
    // …and only those two: a 400, 404 or 409 from one of the reads above is a fault to show, not a session to throw
    // away (review 13 Oct 2026). A refresh the server refused arrives here as a 401 (api.js doRefresh).
    if (err.status === 401 || err.status === 403) {
      endSession(err.status === 403
        ? 'That account no longer exists. Sign in again.'
        : 'Your session has ended. Sign in again.');
    } else {
      // not a verdict on the session: say what failed, on the page, and try once more by itself
      console.error('start failed', err);
      startError = err.message || String(err);
      const retry = !startRetried;
      startRetried = true;
      showStartError(retry);
      if (retry) setTimeout(() => { if (!booted) start(); }, 4000);
    }
  }
}

// The console could not start (0.7.102): instead of an empty shell that later reads
// "No FarmBox yet", the page says what failed and offers to try again.
let startError = null, startRetried = false;
function showStartError(retrying = false) {
  const page = $('page');
  page.textContent = '';
  const e = el('div', 'empty');
  e.append(el('h3', null, 'The console could not start'));
  e.append(el('p', null, startError || 'Unknown error.'));
  if (retrying) e.append(el('p', 'hint', 'It will try again by itself in a few seconds.'));
  const again = el('button', 'btn btn-primary', 'Try again');
  again.onclick = () => { startError = null; start(); };
  e.append(again);
  page.append(e);
}

if (getSession()) start(); else showSignin();
