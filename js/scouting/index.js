// Scouting page: render, older-days read, load and reload
import { rpc, openFast } from '../api.js';
import { useFarm } from '../cases.js';
import { greenhouseKit } from '../greenhouse.js';
import { trapKit } from '../trapmap.js';
import { loading, el } from '../ui.js';
import { openGhRef, readExtras } from './extras.js';
import { openDays, paint } from './paint.js';
import { S, dayData, readFailed, readOk, robotFoot, robotTick } from './state.js';
import { dayRows, thumbsLive, thumbsKept, pendings, panelReads } from './thumbs.js';

export async function renderScouting(container, currentFarm) {
  if (S.farm?.id !== currentFarm.id) {
    dayData.clear(); S.cropFilter = null;
    // what was read beside the page belongs to the unit just left: its pills must not sit on this unit's days while
    // the answers are on their way, nor its opened days open here (review 13 Oct 2026)
    S.extras = []; S.people = []; S.coverage = []; openDays.clear();
    try { S.zoneFilter = localStorage.getItem('fbc_pd_zone_' + currentFarm.id) || null; } catch (e) { S.zoneFilter = null; }
  }
  S.farm = currentFarm; S.mount = container;
  await load();
}

// The days brought by "Show older reports" are read again as well, behind the first 21: kept as they had been read,
// a day changed since — a photo removed, a case tagged — went on showing its old counts and dot on its line, and a
// day emptied stayed as a line with nothing behind it. Only the latest answer counts; the page is painted again only
// when a line differs.
async function rereadOlder(before, n, here) {
  const my = ++S.olderSeq, f = S.farm.id;
  try {
    // in pieces: the function gives 120 days at most in one answer
    let older = [], cursor = before, end = false;
    while (older.length < n && !end) {
      const ask = Math.min(120, n - older.length);
      const part = await rpc('scouting_dates', { p_farm: f, p_before: cursor, p_limit: ask });
      if (my !== S.olderSeq || S.farm?.id !== f || S.mount !== here || !here.isConnected || !Array.isArray(part)) return;
      older = older.concat(part);
      if (part.length < ask) end = true; else cursor = part[part.length - 1].day;
    }
    readOk();
    const head = S.dates.filter(x => String(x.day) >= String(before));
    if (JSON.stringify(older) === JSON.stringify(S.dates.slice(head.length))) return;
    S.dates = head.concat(older);
    if (end) S.moreDone = true;                  // fewer than were asked for: there is nothing older than these
    paint(); readOk();
  } catch { readFailed(true); /* no answer: the lines stay as they were read */ }
}

export async function load(fresh = false) {
  const here = S.mount, a = { p_farm: S.farm.id };
  // last time's copy at once, the server's answer behind it (0.7.107)
  await openFast([
    ['pest_overview', a],
    ['cases', { ...a, p_include_closed: S.showClosed }],
    ['scouting_dates', { ...a, p_before: null, p_limit: 21 }],
    ['pest_catalog', {}],
    ['trap_map', a],
    ['zone_opinions', a],
    ['robot_scouting', { ...a, p_days: 90 }],
  ], {
    show: ([o, c, d, cat, tm, op, rb]) => {
      S.over = o; S.cases = c; S.catalog = cat; S.tmap = tm; S.opinions = op || []; S.robot = rb || null;
      // the days brought by "Show older reports" stay when the page is read again (review 13 Oct 2026: after a tag or a
      // photo removed in an older report, that report left the page)
      const tail = S.datesFarm === S.farm.id && d.length ? S.dates.filter(x => String(x.day) < String(d[d.length - 1].day)) : [];
      S.dates = d.concat(tail); S.datesFarm = S.farm.id;
      S.kit = S.tmap ? trapKit({ farm: S.farm, data: S.tmap, reload, catalog: () => S.catalog || [], aiReady: () => S.aiReadyKnown }) : null;
      useFarm(S.farm, S.catalog);
      if (!tail.length) S.moreDone = d.length < 21;
      dayData.clear(); panelReads.clear(); pendings.clear(); dayRows.clear(); thumbsLive.clear(); thumbsKept.clear();
      // the whole greenhouse: the AI's report and the notes, read beside the page; its panel is the top of it (0.7.237)
      if (!S.gh || S.ghFarm !== S.farm.id) {
        // the kit of the unit just left is let go first: it stops listening and painting (review 13 Oct 2026)
        S.gh?.dispose?.();
        S.ghFarm = S.farm.id;
        const mine = S.farm.id;
        S.gh = greenhouseKit({ farm: S.farm, today: () => S.over?.today, scouted: () => (S.dates || []).map(d => d.day),
                             relist: () => { if (S.farm?.id === mine && S.mount && S.mount.isConnected) paint(); }, openRef: openGhRef,
                             bottom: robotFoot });
      }
      if (!S.robotTimer) S.robotTimer = setInterval(robotTick, 10000);   // stops itself when the page is left (robotTick)
      paint();
      if (tail.length) rereadOlder(d[d.length - 1].day, tail.length, here);
      readExtras(here);
      S.gh.refresh();
    },
    waiting: () => { S.mount.textContent = ''; S.mount.append(loading('Reading the farm…')); },
    failed: e => { S.mount.textContent = ''; S.mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && S.mount === here, fresh,
  });
}
export const reload = () => load(true);   // after a change: the server's answer, not the old copy
