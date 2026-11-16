// Team page: render, load, the page paint, families / gaps / capacity
import { openFast } from '../api.js';
import { renderHours } from '../hours.js';
import { editPerson } from '../people.js';
import { aiLine } from '../team-ai.js';
import { loading, el, setPhotos, pageHead, pref, addDays, parseYmd, isoDow } from '../ui.js';
import { openJobs } from './jobs.js';
import { planCard } from './plan.js';
import { S, teamWeek, which } from './state.js';
import { table } from './table.js';

export async function renderTeam(container, currentFarm) {
  S.farm = currentFarm; S.mount = container; S.preview = null;
  await load();
}

async function load(fresh = false) {
  const here = S.mount;
  await openFast([['team_setup', { p_farm: S.farm.id }], ['labour_hours', { p_farm: S.farm.id, ...teamWeek() }],
                  ['people', { p_farm: S.farm.id }], ['family_tree', { p_farm: S.farm.id }], ['mcp_team', { p_farm: S.farm.id }, true]], {
    show: ([t, h, p, tr, ai]) => {
      S.T = t; S.hours = h; S.people = p || []; S.tree = tr || [];
      S.AI = ai?.may_edit ? { ...ai, farm_id: S.farm.id } : null;
      setPhotos(S.people);
      paint();
    },
    waiting: () => { S.mount.textContent = ''; S.mount.append(loading('Reading the team of ' + S.farm.name + '…')); },
    failed: e => { S.mount.textContent = ''; S.mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && S.mount === here, fresh,
  });
}
export const reload = () => { S.preview = null; return load(true); };
// what the profile window needs from this page
export const ctx = () => ({ farm: S.farm, people: S.people, team: true, done: reload, me: S.T?.me, ai: S.AI });
export const profile = id => S.people.find(x => x.worker_id === id);

// family_tree is one row per family / sub-family pair
export function families() {
  const out = new Map();
  for (const r of S.tree) {
    if (!out.has(r.family)) out.set(r.family, { name: r.family, cats: [] });
    if (r.category) out.get(r.family).cats.push(r.category);
  }
  return [...out.values()];
}

// a family nobody is responsible for (the family as a whole, or each of its sub-families)
function gaps() {
  // somebody off the task pages is never given the work (0229): a family only they hold is nobody's
  const off = new Set((S.T.people || []).filter(p => p.off_tasks).map(p => p.worker_id));
  const held = new Set((S.T.keys || []).filter(k => (k.order || []).some(o => !off.has(o.worker_id))).map(k => k.family + '|' + (k.category || '')));
  const out = [];
  for (const f of families()) {
    if (held.has(f.name + '|')) continue;
    if (!f.cats.length) { out.push([f.name, ['everything']]); continue; }
    const miss = f.cats.filter(c => !held.has(f.name + '|' + c));
    if (miss.length) out.push([f.name, miss]);
  }
  return out;
}

export function capacity(p) {
  const from = parseYmd(teamWeek().p_from);
  let n = 0;
  for (let i = 0; i < 7; i++) if ((p.working_days || []).includes(isoDow(addDays(from, i)))) n++;
  return n * Number(p.hours_per_day || 0) * 60;
}

export function paint() {
  S.mount.textContent = '';
  const may = !!S.T.may_edit;
  const w = which();

  const seg = el('div', 'seg');
  [['this', 'This week'], ['next', 'Next week']].forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(v === w));
    b.onclick = () => { pref.set('fbc_team_week', v); S.preview = null; load(); };
    seg.append(b);
  });
  const add = may ? el('button', 'btn btn-primary', '＋ Add person') : null;
  if (add) add.onclick = () => editPerson(ctx(), null);
  const jobs = may ? el('button', 'btn', 'Jobs…') : null;
  if (jobs) jobs.onclick = openJobs;
  S.mount.append(pageHead(null,
    may ? 'Who is responsible for what, in order: the plan gives work to number 1 until their day is full, then to number 2. Click a label to renumber.'
        : 'What you are responsible for, and your place for each kind of work.',
    seg, jobs, add));

  if (may) {
    const g = gaps();
    if (g.length) {
      const n = el('div', 'note warn team-gaps');
      n.append(document.createTextNode('Nobody is responsible for '));
      g.forEach(([family, list], i) => {
        if (i) n.append(document.createTextNode('; '));
        n.append(el('b', null, family), document.createTextNode(': ' + list.join(', ')));
      });
      n.append(document.createTextNode('. Those tasks go to whoever has room in the week.'));
      S.mount.append(n);
    }
    if (Number(S.T.problems)) S.mount.append(el('div', 'note bad team-gaps',
      'Some numbers are out of order. Change any number on this page and they are put right.'));
  }

  const card = el('div', 'card');
  const wrap = el('div', 'table-wrap');
  wrap.append(table(may));
  card.append(wrap);
  S.mount.append(card);

  if (may) S.mount.append(planCard());
  // AI access (0242): set in each person's Edit window; here only who has it, what was asked, Stop all (0.7.265)
  if (may && S.AI) S.mount.append(aiLine(S.AI, reload));

  // the old Hours page, as it was
  const fold = el('details', 'card card-pad team-hours');
  fold.open = S.hoursOpen;
  fold.append(el('summary', 'sec-title', 'Hours worked and what they cost'));
  const inner = el('div', 'team-hours-in');
  fold.append(inner);
  const fill = () => { if (!inner.dataset.on) { inner.dataset.on = '1'; renderHours(inner, S.farm); } };
  fold.addEventListener('toggle', () => { S.hoursOpen = fold.open; if (fold.open) fill(); });
  if (S.hoursOpen) fill();
  S.mount.append(fold);
}
