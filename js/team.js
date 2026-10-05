// ═════════════════════════════════════════════════════════════════════
// Tasks › Team (migration 0216, console 0.7.222)
//
// One page for the people, what each of them is responsible for, and who comes
// first — it replaces Farm setup › People and Tasks › Hours.
//
// For every family or sub-family the people responsible for it are numbered
// 1…k ("Crop care 1", "Crop care 2"): the plan gives the work to number 1
// until their day is full, then to number 2. The numbers come from the job
// (what the job is responsible for) and the person's place among the people
// with the same job; a chip is clicked to set one number by hand. A number is
// never held twice: choosing one that is taken shows who holds it and both
// ways out (swap, or insert and move the others down) before anything changes.
// ═════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, field, selectBox, toast, drawer, confirmDrawer, avatar, busy, setPhotos, subFamilyTag,
         pageHead, pref, farmDate, farmToday, ymd, addDays, mondayOf, parseYmd, isoDow } from './ui.js';
import { roleLabel as knownRole, employmentLabel, editPerson, personActions } from './people.js';
import { renderHours } from './hours.js';

const hrs = m => { m = Math.round(Number(m || 0)); const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`; };
const DAY = ['', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];
// a job the profile form does not offer (a trainee comes from Notion) still has a name here
const roleLabel = r => { const l = knownRole(r); return l === r ? String(r || 'No job').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : l; };
const keyLabel = r => r.category || 'All ' + r.family;
const sameKey = (a, b) => a.family === b.family && (a.category || null) === (b.category || null);
const first = name => String(name || '');        // worker.name is the first name already ("Worker 3" must stay whole)

const which = () => pref.get('fbc_team_week') === 'next' ? 'next' : 'this';
export function teamWeek(w = which()) {
  const mon = mondayOf(farmDate());
  const m = w === 'next' ? addDays(mon, 7) : mon;
  return { p_from: ymd(m), p_to: ymd(addDays(m, 6)) };
}

let farm = null, mount = null, T = null, people = [], tree = [], hours = null, preview = null, showOff = false, hoursOpen = false;

export async function renderTeam(container, currentFarm) {
  farm = currentFarm; mount = container; preview = null;
  await load();
}

async function load(fresh = false) {
  const here = mount;
  await openFast([['team_setup', { p_farm: farm.id }], ['labour_hours', { p_farm: farm.id, ...teamWeek() }],
                  ['people', { p_farm: farm.id }], ['family_tree', { p_farm: farm.id }]], {
    show: ([t, h, p, tr]) => {
      T = t; hours = h; people = p || []; tree = tr || [];
      setPhotos(people);
      paint();
    },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the team of ' + farm.name + '…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here, fresh,
  });
}
const reload = () => { preview = null; return load(true); };
// what the profile window needs from this page
const ctx = () => ({ farm, people, team: true, done: reload });
const profile = id => people.find(x => x.worker_id === id);

// family_tree is one row per family / sub-family pair
function families() {
  const out = new Map();
  for (const r of tree) {
    if (!out.has(r.family)) out.set(r.family, { name: r.family, cats: [] });
    if (r.category) out.get(r.family).cats.push(r.category);
  }
  return [...out.values()];
}

// a family nobody is responsible for (the family as a whole, or each of its sub-families)
function gaps() {
  const held = new Set((T.keys || []).filter(k => (k.order || []).length).map(k => k.family + '|' + (k.category || '')));
  const out = [];
  for (const f of families()) {
    if (held.has(f.name + '|')) continue;
    if (!f.cats.length) { out.push([f.name, ['everything']]); continue; }
    const miss = f.cats.filter(c => !held.has(f.name + '|' + c));
    if (miss.length) out.push([f.name, miss]);
  }
  return out;
}

function capacity(p) {
  const from = parseYmd(teamWeek().p_from);
  let n = 0;
  for (let i = 0; i < 7; i++) if ((p.working_days || []).includes(isoDow(addDays(from, i)))) n++;
  return n * Number(p.hours_per_day || 0) * 60;
}

function paint() {
  mount.textContent = '';
  const may = !!T.may_edit;
  const w = which();

  const seg = el('div', 'seg');
  [['this', 'This week'], ['next', 'Next week']].forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(v === w));
    b.onclick = () => { pref.set('fbc_team_week', v); preview = null; load(); };
    seg.append(b);
  });
  const add = may ? el('button', 'btn btn-primary', '＋ Add person') : null;
  if (add) add.onclick = () => editPerson(ctx(), null);
  const jobs = may ? el('button', 'btn', 'Jobs…') : null;
  if (jobs) jobs.onclick = openJobs;
  mount.append(pageHead(null,
    may ? 'The people, what each is responsible for, and who comes first. For every family the people are numbered: ' +
          'the plan gives the work to number 1 until their day is full, then to number 2. Click a label to change its number.'
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
      mount.append(n);
    }
    if (Number(T.problems)) mount.append(el('div', 'note bad team-gaps',
      'Some numbers are out of order. Change any number on this page and they are put right.'));
  }

  const card = el('div', 'card');
  const wrap = el('div', 'table-wrap');
  wrap.append(table(may));
  card.append(wrap);
  mount.append(card);

  if (may) mount.append(planCard());

  // the old Hours page, as it was
  const fold = el('details', 'card card-pad team-hours');
  fold.open = hoursOpen;
  fold.append(el('summary', 'sec-title', 'Hours worked and what they cost'));
  const inner = el('div', 'team-hours-in');
  fold.append(inner);
  const fill = () => { if (!inner.dataset.on) { inner.dataset.on = '1'; renderHours(inner, farm); } };
  fold.addEventListener('toggle', () => { hoursOpen = fold.open; if (fold.open) fill(); });
  if (hoursOpen) fill();
  mount.append(fold);
}

function table(may) {
  const t = el('table', 'people team-table');
  const hr = el('tr');
  ['Person', 'Place in the job', 'Responsible for', which() === 'next' ? 'Next week' : 'This week', ''].forEach(h => hr.append(el('th', null, h)));
  const thead = el('thead'); thead.append(hr); t.append(thead);
  const tb = el('tbody');

  const all = T.people || [];
  const active = all.filter(p => p.active), off = all.filter(p => !p.active);
  const hp = new Map((hours?.people || []).map(x => [x.worker_id, x]));

  // every job the database lists, then any job it does not (so nobody is ever missing from the page)
  const listed = new Set((T.jobs || []).map(j => j.role));
  const jobs = [...(T.jobs || []), ...[...new Set(active.map(p => p.role))].filter(r => !listed.has(r)).map(r => ({ role: r, bundle: [], unlisted: true }))];
  jobs.forEach(job => {
    const ppl = active.filter(p => p.role === job.role);
    if (!ppl.length) return;
    const jr = el('tr', 'team-job');
    const jd = el('td'); jd.colSpan = 5;
    const line = el('div', 'team-jobline');
    line.append(el('b', null, roleLabel(job.role)), el('span', 'hint', ppl.length === 1 ? '1 person' : `${ppl.length} people`));
    if (may && !job.unlisted) {
      const bundle = job.bundle || [];
      line.append(el('span', 'hint team-jobhas', bundle.length
        ? 'The job covers: ' + bundle.map(keyLabel).join(', ')
        : 'The job covers nothing by itself yet.'));
      const edit = el('button', 'btn btn-sm btn-ghost', 'Change…');
      edit.onclick = () => openJob(job);
      line.append(el('span', 'spacer'), edit);
    }
    jd.append(line); jr.append(jd); tb.append(jr);
    ppl.forEach(p => tb.append(personRow(p, ppl.length, may, hp.get(p.worker_id))));
  });
  if (!active.length) {
    const tr = el('tr'); const td = el('td'); td.colSpan = 5;
    const e = el('div', 'empty');
    e.append(el('h3', null, 'Nobody here yet'), el('p', null, 'Add the manager first, then the people who run the week.'));
    td.append(e); tr.append(td); tb.append(tr);
  }

  if (off.length && may) {
    const jr = el('tr', 'team-job');
    const jd = el('td'); jd.colSpan = 5;
    const b = el('button', 'btn btn-sm btn-ghost', (showOff ? '▾ ' : '▸ ') + `Switched off · ${off.length}`);
    b.onclick = () => { showOff = !showOff; paint(); };
    jd.append(b); jr.append(jd); tb.append(jr);
    if (showOff) off.forEach(p => tb.append(personRow(p, 0, may, hp.get(p.worker_id))));
  }
  t.append(tb);
  return t;
}

const tdOf = child => { const c = el('td'); if (child) c.append(child); return c; };

function personRow(p, inJob, may, h) {
  const tr = el('tr', 'team-row');
  if (!p.active) tr.classList.add('off');
  const prof = profile(p.worker_id);

  const who = el('div', 'who');
  who.append(avatar({ ...p, photo_url: prof?.photo_url }));
  const names = el('div');
  names.append(el('b', null, [p.name, p.surname].filter(Boolean).join(' ')));
  const days = (p.working_days || []).map(d => DAY[d] || '').join('');
  names.append(el('small', null, `${employmentLabel(p.employment)} · ${days || 'no days'} · ${Number(p.hours_per_day)} h` + (p.has_login ? '' : ' · no login')));
  who.append(names);
  tr.append(tdOf(who));

  // the place among the people with the same job
  const place = el('td', 'team-place');
  if (!p.active) place.append(el('span', 'hint', '—'));
  else if (!may || inJob < 2) place.append(el('span', 'team-placeno', String(p.team_priority ?? '—')), el('span', 'hint', inJob < 2 ? ' only one' : ` of ${inJob}`));
  else {
    const sel = selectBox(Array.from({ length: inJob }, (_, i) => [String(i + 1), `${i + 1} of ${inJob}`]), String(p.team_priority ?? ''));
    sel.classList.add('team-sel');
    sel.setAttribute('aria-label', `Place of ${p.name} among the ${roleLabel(p.role)}s`);
    sel.title = 'Their place among the people with the same job. It orders every family the job covers, except the numbers set by hand.';
    sel.onchange = () => openGlobal(p, Number(sel.value));
    place.append(sel);
  }
  tr.append(place);

  // the numbered responsibilities
  const chips = el('div', 'chips team-chips');
  (p.rows || []).forEach(r => chips.append(chip(p, r, may && p.active)));
  if (!(p.rows || []).length) chips.append(el('span', 'hint', 'nothing — free for anything'));
  if (may && p.active) {
    const plus = el('button', 'chip team-plus', '＋');
    plus.title = 'Add a responsibility for ' + p.name;
    plus.setAttribute('aria-label', plus.title);
    plus.onclick = () => openAdd(p);
    chips.append(plus);
  }
  tr.append(tdOf(chips));

  // the week: what is planned for them against what their week holds
  const wk = el('td', 'team-week');
  const planned = Number(h?.planned || 0), cap = capacity(p);
  if (p.active) {
    if (p.employment === 'casual') wk.append(el('span', 'hint', planned ? `on demand · ${hrs(planned)} planned` : 'on demand'));
    else {
      const bar = el('div', 'yd-bar' + (cap && planned > cap ? ' short' : ''));
      const f = el('i'); f.style.width = (cap ? Math.min(100, Math.round(100 * planned / cap)) : 0) + '%';
      bar.append(f);
      wk.append(bar, el('span', cap && planned > cap ? 'team-over' : '', `${hrs(planned)} of ${hrs(cap)}`));
    }
    const after = preview?.after?.[p.worker_id];
    if (preview) wk.append(el('div', 'team-then', `with this team: ${hrs(after?.minutes || 0)}`));
    if (Number(h?.clocked)) wk.append(el('div', 'hint', `worked ${hrs(h.clocked)}`));
  }
  tr.append(wk);

  const acts = el('div', 'acts');
  if (may) {
    const edit = el('button', 'btn btn-sm', 'Edit');
    edit.onclick = () => editPerson(ctx(), prof || p);
    acts.append(edit);
    if (p.active) {
      const rep = el('button', 'btn btn-sm', 'Replace…');
      rep.title = `Somebody else takes over what ${p.name} is responsible for`;
      rep.onclick = () => openReplace(p);
      acts.append(rep);
    }
    const more = el('button', 'btn btn-sm btn-ghost', '⋯');
    more.setAttribute('aria-label', 'More actions for ' + p.name);
    more.onclick = () => personActions(ctx(), prof || p);
    acts.append(more);
  }
  tr.append(tdOf(acts));
  return tr;
}

// "Crop care 1" — the family in its colour, the number, a mark when the number was set by hand
function chip(p, r, may) {
  const c = r.category ? subFamilyTag(r.category, 'chip') : el('span', 'chip fam-' + r.family, 'All ' + r.family);
  c.classList.add('team-chip');
  if (r.priority) c.append(el('b', 'team-n', String(r.priority)));
  if (r.fixed) c.classList.add('pinned');
  c.title = `${keyLabel(r)} — ${r.priority ? `number ${r.priority} of ${r.of}` : 'no number'}`
    + (r.fixed ? ' · set by hand' : '') + (r.manual ? '' : ' · given by the job');
  if (may) {
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.onclick = () => openKey(p, r);
    c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKey(p, r); } };
  }
  return c;
}

// "1 Naison · 2 Dial · 3 Aqeel", the people who moved in bold
function orderLine(list, before) {
  const s = el('span', 'team-line');
  const was = new Map((before || []).map(o => [o.worker_id, o.priority]));
  (list || []).forEach((o, i) => {
    if (i) s.append(document.createTextNode(' · '));
    const moved = before && was.get(o.worker_id) !== o.priority;
    s.append(el(moved ? 'b' : 'span', null, `${o.priority} ${first(o.name)}`));
  });
  if (!(list || []).length) s.append(document.createTextNode('nobody'));
  return s;
}
const sameOrder = (a, b) => (a || []).map(o => o.worker_id).join() === (b || []).map(o => o.worker_id).join();

// ── one family: who is asked first ──────────────────────────────────────────
function openKey(p, r) {
  const label = keyLabel(r);
  const key = (T.keys || []).find(k => sameKey(k, r));
  const order = key?.order || [];
  const d = drawer(label, 'Who is asked first. Number 1 takes the work until their day is full, then number 2.');
  let subject = p.worker_id;
  const body = el('div');
  d.body.append(body);

  const send = async (n, mode, btn) => {
    if (btn) busy(btn, true, 'Saving…');
    try {
      const res = await rpc('team_set_priority', { p_worker: subject, p_family: r.family, p_category: r.category || null, p_n: n, p_mode: mode });
      if (res?.conflict) return res;
      d.close();
      toast(`${label}: ` + (res.order || []).map(o => `${o.priority} ${first(o.name)}`).join(' · '), 'ok');
      await reload();
      return null;
    } catch (e) { if (btn) busy(btn, false); toast(e.message, 'bad'); return null; }
  };

  const draw = () => {
    body.textContent = '';
    const list = el('div', 'team-order');
    order.forEach(o => {
      const row = el('button', 'team-orow');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(o.worker_id === subject));
      const txt = el('span', 'team-oname');
      txt.append(el('b', null, o.name), el('small', null, roleLabel(o.role)
        + (o.employment === 'casual' ? ' · on demand' : '') + (o.fixed ? ' · set by hand' : '')));
      row.append(el('span', 'team-on', String(o.priority ?? '–')), avatar({ ...o, photo_url: profile(o.worker_id)?.photo_url }, 'sm'), txt);
      row.onclick = () => { subject = o.worker_id; draw(); };
      list.append(row);
    });
    body.append(list);
    if (order.some(o => o.employment === 'casual')) body.append(el('div', 'hint team-hint',
      'Somebody on demand is asked only after the standing team, whatever their number — calling them in is your decision.'));

    const me = order.find(o => o.worker_id === subject);
    if (!me) return;
    const out = el('div', 'team-conflict');
    const sel = selectBox(order.map((_, i) => [String(i + 1), String(i + 1)]), String(me.priority));
    sel.disabled = order.length < 2;
    sel.onchange = async () => {
      out.textContent = '';
      const n = Number(sel.value);
      if (n === me.priority) return;
      out.append(loading('Checking…'));
      const res = await send(n, null);
      out.textContent = '';
      if (res?.conflict) conflict(out, res, n, me);
      else if (res === null && document.body.contains(sel)) sel.value = String(me.priority);
    };
    body.append(field(`${me.name}’s number for ${label}`, sel,
      order.length < 2 ? 'Nobody else is responsible for it.' : 'Choose a number; you are shown who holds it before anything changes.'));
    body.append(out);

    const more = el('div', 'row team-more');
    if (me.fixed) {
      const back = el('button', 'btn btn-sm', 'Back to the job’s order');
      back.title = 'Take the hand-set number off: the place in the job decides again';
      back.onclick = () => send(null, null, back);
      more.append(back);
    }
    const off = el('button', 'btn btn-sm btn-ghost team-danger', `Take ${label} off ${first(me.name)}`);
    off.onclick = async () => {
      if (!await confirmDrawer(`Take ${label} off ${me.name}?`,
        `${me.name} is no longer responsible for ${label}` + (me.manual ? '.' : ', although the job covers it — it stays off for them until added again.')
        + ' The others move up.', 'Take it off', true)) return;
      try {
        await rpc('team_remove', { p_worker: me.worker_id, p_family: r.family, p_category: r.category || null });
        d.close(); toast(`${label} taken off ${me.name}`, 'ok'); await reload();
      } catch (e) { toast(e.message, 'bad'); }
    };
    more.append(off);
    body.append(more);
  };

  // the number is somebody's: who, and the two ways out
  const conflict = (out, res, n, me) => {
    const box = el('div', 'note warn team-ask');
    box.append(el('b', null, `${res.holder.name} holds ${label} ${n}.`));
    const same = sameOrder(res.swap, res.insert);
    let mode = 'swap';
    const opts = el('div', 'team-opts');
    const opt = (v, title, list) => {
      const l = el('label', 'team-opt');
      const rb = el('input'); rb.type = 'radio'; rb.name = 'team-mode'; rb.checked = v === mode;
      rb.onchange = () => { mode = v; };
      const t = el('span');
      t.append(el('b', null, title), el('br'), orderLine(list, res.before));
      l.append(rb, t);
      opts.append(l);
    };
    if (same) {
      box.append(el('div', null, `${first(res.holder.name)} becomes ${me.priority}:`), orderLine(res.swap, res.before));
    } else {
      opt('swap', `Swap — ${first(res.holder.name)} takes ${first(me.name)}’s ${me.priority}`, res.swap);
      opt('insert', `Insert — ${first(me.name)} takes ${n}, the others move down one`, res.insert);
      box.append(opts);
    }
    const go = el('button', 'btn btn-primary btn-sm', 'Apply');
    go.onclick = () => send(n, mode, go);
    const no = el('button', 'btn btn-sm', 'Leave it');
    no.onclick = () => draw();
    const row = el('div', 'row team-more'); row.append(go, no);
    box.append(row);
    out.append(box);
  };

  draw();
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

// ── the place in the job: every family the job covers follows — shown first ─
function openGlobal(p, n) {
  let applied = false;
  const d = drawer(`${p.name} — place ${n} among the ${roleLabel(p.role)}s`,
    'The place in the job orders every family the job covers. Nothing changes until you apply.',
    { onClose: () => { if (!applied) paint(); } });
  let mode = 'swap', res = null;
  const follow = new Set();            // families where the hand-set numbers give way
  const kid = k => k.family + '|' + (k.category || '');
  const body = el('div');
  d.body.append(body);
  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Apply');
  go.disabled = true;
  d.footer.append(cancel, el('div', 'spacer'), go);

  const read = async () => {
    body.textContent = ''; body.append(loading('Working out what changes…'));
    go.disabled = true;
    try {
      res = await rpc('team_set_global', { p_worker: p.worker_id, p_n: n, p_mode: mode, p_take: [], p_preview: true });
      draw();
      go.disabled = false;
    } catch (e) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); }
  };

  const draw = () => {
    body.textContent = '';
    const job = el('div', 'team-block');
    job.append(el('div', 'sec-title', `The ${roleLabel(p.role)}s`));
    job.append(el('div', 'team-ba', null));
    const ba = job.lastChild;
    ba.append(el('span', 'hint', 'now '), orderLine(res.job_before), el('br'), el('span', 'hint', 'then '), orderLine(res.job_after, res.job_before));
    body.append(job);

    if (res.holder && (res.job_before || []).length > 2) {
      const opts = el('div', 'team-opts');
      [['swap', `Swap with ${res.holder.name}`], ['insert', 'Insert — the others move down one']].forEach(([v, title]) => {
        const l = el('label', 'team-opt');
        const rb = el('input'); rb.type = 'radio'; rb.name = 'team-gmode'; rb.checked = v === mode;
        rb.onchange = () => { mode = v; follow.clear(); read(); };
        l.append(rb, el('span', null, title));
        opts.append(l);
      });
      body.append(opts);
    }

    const keys = res.keys || [];
    const choices = keys.filter(k => k.choice);
    body.append(el('div', 'sec-title team-sec', keys.length ? `Family by family · ${keys.length}` : 'Family by family'));
    if (!keys.length) body.append(el('div', 'hint', 'No family changes its order: each is held by one of them, or the others come before by their job.'));
    if (choices.length) {
      const note = el('div', 'note warn team-ask');
      note.append(document.createTextNode(`${choices.length === 1 ? 'One family has' : choices.length + ' families have'} numbers set by hand that the new order would not give. ` +
        'They are kept unless you hand the family back to the job’s order.'));
      const allb = el('button', 'btn btn-sm', follow.size === choices.length ? 'Keep them all' : 'Follow the new order everywhere');
      allb.onclick = () => { if (follow.size === choices.length) follow.clear(); else choices.forEach(k => follow.add(kid(k))); draw(); };
      const row = el('div', 'row team-more'); row.append(allb); note.append(row);
      body.append(note);
    }
    keys.forEach(k => {
      const b = el('div', 'team-key');
      const head = el('div', 'team-keyhead');
      head.append(k.category ? subFamilyTag(k.category, 'chip') : el('span', 'chip fam-' + k.family, 'All ' + k.family));
      b.append(head);
      const after = follow.has(kid(k)) ? k.follow : k.keep;
      const same = sameOrder(k.before, after);
      const line = el('div', 'team-ba');
      line.append(el('span', 'hint', 'now '), orderLine(k.before));
      if (same) line.append(el('span', 'hint', '  ·  stays as it is'));
      else line.append(el('br'), el('span', 'hint', 'then '), orderLine(after, k.before));
      b.append(line);
      if (k.choice) {
        const pins = (k.pins || []).map(o => `${first(o.name)} ${o.priority}`).join(', ');
        const sw = el('div', 'seg team-seg');
        [[false, 'Keep the hand-set numbers'], [true, 'Follow the new order']].forEach(([v, title]) => {
          const x = el('button', 'seg-btn', title);
          x.type = 'button';
          x.setAttribute('aria-pressed', String(follow.has(kid(k)) === v));
          x.onclick = () => { if (v) follow.add(kid(k)); else follow.delete(kid(k)); draw(); };
          sw.append(x);
        });
        b.append(el('div', 'hint', pins ? `Set by hand: ${pins}` : 'Numbers set by hand'), sw);
      }
      body.append(b);
    });
  };

  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      const take = (res.keys || []).filter(k => follow.has(kid(k))).map(k => ({ family: k.family, category: k.category || '' }));
      await rpc('team_set_global', { p_worker: p.worker_id, p_n: n, p_mode: mode, p_take: take, p_preview: false });
      applied = true;
      d.close();
      toast(`${p.name} is ${n} among the ${roleLabel(p.role)}s`, 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Apply'); toast(e.message, 'bad'); }
  };
  read();
}

// ── a replacement ───────────────────────────────────────────────────────────
function openReplace(p) {
  const others = (T.people || []).filter(x => x.active && x.worker_id !== p.worker_id);
  const d = drawer(`Replace ${p.name}`, 'Somebody else takes over everything they are responsible for, at the same numbers');
  if (!others.length) {
    d.body.append(el('div', 'note', 'There is nobody else on the team yet. Add the new person first (＋ Add person), then come back.'));
    const c = el('button', 'btn', 'Close'); c.onclick = d.close; d.footer.append(c);
    return;
  }
  const who = selectBox(others.map(x => [x.worker_id, `${x.name} · ${roleLabel(x.role)}`]), others[0].worker_id);
  const tasks = el('input'); tasks.type = 'checkbox'; tasks.checked = true; tasks.id = 'team-rt';
  const from = el('input', 'input'); from.type = 'date'; from.value = farmToday();
  const trow = el('label', 'team-opt');
  trow.append(tasks, el('span', null, `Also hand over ${first(p.name)}’s open tasks from`));
  const what = el('div', 'chips team-chips');
  (p.rows || []).forEach(r => what.append(chip(p, r, false)));
  if (!(p.rows || []).length) what.append(el('span', 'hint', 'nothing'));
  const note = el('div', 'hint team-hint');
  const say = () => {
    const x = others.find(o => o.worker_id === who.value);
    note.textContent = x.role === p.role
      ? `${x.name} has the same job: they take ${first(p.name)}’s place in it, and ${first(p.name)} stands right behind.`
      : `${x.name} is a ${roleLabel(x.role)}: they take each of these numbers by hand (shown as set by hand), and keep what they already have.`;
  };
  who.onchange = say; say();
  d.body.append(
    field('Who takes over', who, 'A new person? Add them first with ＋ Add person.'),
    note,
    el('div', 'sec-title team-sec', `What ${first(p.name)} holds`), what,
    el('div', 'sec-title team-sec', 'Their tasks'), trow, field('From', from, 'A task already started, or with a report, stays with the person who has it.'),
    el('div', 'hint team-hint', `${p.name} stays on the team until you switch them off (⋯ › Make inactive).`));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Replace');
  go.onclick = async () => {
    const x = others.find(o => o.worker_id === who.value);
    busy(go, true, 'Replacing…');
    try {
      const res = await rpc('team_replace', { p_old: p.worker_id, p_new: who.value, p_from: tasks.checked ? (from.value || farmToday()) : null });
      d.close();
      toast(`${x.name} took over ${res.responsibilities} responsibilit${res.responsibilities === 1 ? 'y' : 'ies'}`
        + (tasks.checked ? ` and ${res.tasks} task${res.tasks === 1 ? '' : 's'}` : '')
        + (res.tasks_left ? ` · ${res.tasks_left} already started stay with ${first(p.name)}` : ''), 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Replace'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}

// ── a responsibility for one person ─────────────────────────────────────────
function openAdd(p) {
  const d = drawer(`Add for ${p.name}`, 'A family, or one of its sub-families. They join at the place their job gives them.');
  const has = new Set((p.rows || []).map(r => r.family + '|' + (r.category || '')));
  const offJob = new Set((p.excluded || []).map(r => r.family + '|' + (r.category || '')));
  const fams = families();
  if (!fams.length) d.body.append(el('div', 'note', 'No task families yet. Add them in Settings › Task families and come back.'));
  const add = async (family, category, b) => {
    busy(b, true, 'Adding…');
    try {
      await rpc('team_add', { p_worker: p.worker_id, p_family: family, p_category: category });
      d.close(); toast(`${category || 'All ' + family} added for ${p.name}`, 'ok'); await reload();
    } catch (e) { busy(b, false); toast(e.message, 'bad'); }
  };
  fams.forEach(f => {
    const box = el('div', 'resp-fam');
    const head = el('header'); head.append(el('b', null, f.name));
    box.append(head);
    const cats = el('div', 'resp-cats');
    const btn = (label, category) => {
      const k = f.name + '|' + (category || '');
      const b = el('button', 'toggle' + (category ? '' : ' all'), label + (offJob.has(k) ? ' · part of the job, taken off' : ''));
      b.type = 'button';
      if (has.has(k)) { b.disabled = true; b.setAttribute('aria-pressed', 'true'); b.title = 'already theirs'; }
      else b.onclick = () => add(f.name, category, b);
      cats.append(b);
    };
    btn('All of ' + f.name, null);
    f.cats.forEach(c => btn(c, c));
    box.append(cats);
    d.body.append(box);
  });
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
}

// ── what a job is responsible for ───────────────────────────────────────────
function openJobs() {
  const d = drawer('Jobs', 'What each job is responsible for at ' + farm.name + '. Everybody with the job gets it.');
  (T.jobs || []).forEach(job => {
    const b = el('div', 'team-key');
    const head = el('div', 'team-keyhead');
    head.append(el('b', null, roleLabel(job.role)), el('span', 'hint', Number(job.people) === 1 ? '1 person' : `${job.people} people`), el('span', 'spacer'));
    const edit = el('button', 'btn btn-sm', 'Change…');
    edit.onclick = () => { d.close(); openJob(job); };
    head.append(edit);
    b.append(head);
    const chips = el('div', 'chips team-chips');
    (job.bundle || []).forEach(r => chips.append(r.category ? subFamilyTag(r.category, 'chip') : el('span', 'chip fam-' + r.family, 'All ' + r.family)));
    if (!(job.bundle || []).length) chips.append(el('span', 'hint', 'nothing by itself'));
    b.append(chips);
    d.body.append(b);
  });
  d.body.append(el('div', 'hint team-hint',
    'Across jobs the order is: Farm manager, Farm assistant, Agronomist, Technician, Worker, Office, Admin — then the place in the job. A number set by hand on a label wins over both.'));
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
}

function openJob(job) {
  const d = drawer(roleLabel(job.role), 'What this job is responsible for. Everybody with the job follows.');
  const chosen = new Set((job.bundle || []).map(r => r.family + '|' + (r.category || '')));
  const before = new Set(chosen);
  const fams = families();
  const body = el('div');
  d.body.append(body);
  const draw = () => {
    body.textContent = '';
    if (!fams.length) body.append(el('div', 'note', 'No task families yet. Add them in Settings › Task families and come back.'));
    fams.forEach(f => {
      const box = el('div', 'resp-fam');
      const head = el('header'); head.append(el('b', null, f.name));
      box.append(head);
      const cats = el('div', 'resp-cats');
      const btn = (label, category) => {
        const k = f.name + '|' + (category || '');
        const b = el('button', 'toggle' + (category ? '' : ' all'), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(chosen.has(k)));
        b.onclick = () => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); draw(); };
        cats.append(b);
      };
      btn('All of ' + f.name, null);
      f.cats.forEach(c => btn(c, c));
      box.append(cats);
      body.append(box);
    });
    const plus = [...chosen].filter(k => !before.has(k)), minus = [...before].filter(k => !chosen.has(k));
    const nice = k => { const [fam, cat] = k.split('|'); return cat || 'All ' + fam; };
    const n = Number(job.people);
    const say = el('div', 'note' + (minus.length ? ' warn' : ''));
    say.textContent = !n ? 'Nobody has this job yet. Whoever is given it gets what is chosen here.'
      : !plus.length && !minus.length ? `${n} ${n === 1 ? 'person has' : 'people have'} this job.`
      : [plus.length ? `Added for ${n === 1 ? 'the one person' : 'all ' + n + ' people'} with this job: ${plus.map(nice).join(', ')} (not for somebody it was taken off by hand).` : '',
         minus.length ? `Taken off them: ${minus.map(nice).join(', ')} — unless it was added for one person by hand.` : ''].filter(Boolean).join(' ');
    body.append(say);
  };
  draw();
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      const rows = [...chosen].map(k => { const [family, category] = k.split('|'); return { family, category: category || '' }; });
      await rpc('team_save_bundle', { p_farm: farm.id, p_role: job.role, p_rows: rows });
      d.close(); toast(`${roleLabel(job.role)}: saved`, 'ok'); await reload();
    } catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}

// ── the plan with this team: tried first, applied on a click ────────────────
function planRange() {
  const r = teamWeek();
  const today = farmToday();
  return { p_from: r.p_from < today ? today : r.p_from, p_to: r.p_to };
}
const niceDay = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function planCard() {
  const c = el('div', 'card card-pad team-plan');
  const r = planRange();
  const span = `${niceDay(r.p_from)} – ${niceDay(r.p_to)}`;
  c.append(el('div', 'sec-title', `The plan with this team · ${span}`));
  if (r.p_to < r.p_from) { c.append(el('div', 'hint', 'This week is over.')); return c; }
  c.append(el('div', 'hint', 'See what “Assign automatically” would give each person with the numbers above. Nothing changes until you apply it; ' +
    'the Friday plan uses the same numbers by itself.'));
  const row = el('div', 'row team-more');
  const tryb = el('button', 'btn', preview ? 'Preview again' : 'Preview the plan');
  tryb.onclick = async () => {
    busy(tryb, true, 'Trying…');
    try { preview = await rpc('team_preview', { p_farm: farm.id, ...r }); paint(); }
    catch (e) { busy(tryb, false); toast(e.message, 'bad'); }
  };
  row.append(tryb);
  if (preview) {
    const res = preview.result || {};
    const un = res.unassigned || [], ci = res.call_ins || [];
    const say = el('div', 'note' + (un.length ? ' warn' : ''));
    say.textContent = `${res.assigned ?? 0} of ${res.tasks ?? 0} open tasks would get a name — each person’s hours are in the table above (“with this team”).`
      + (un.length ? ` ${un.length} would stay without: ${un[0].reason}.` : '')
      + (ci.length ? ` ${ci.length} call-in${ci.length > 1 ? 's' : ''} (${[...new Set(ci.map(x => x.worker))].join(', ')}).` : '')
      + (res.left_alone ? ` ${res.left_alone} already started stay as they are.` : '');
    c.append(say);
    const apply = el('button', 'btn btn-primary', 'Apply to the open tasks');
    apply.onclick = async () => {
      if (!await confirmDrawer('Apply this plan?',
        `The names on the open tasks of ${span} are replaced by this plan — also the ones somebody chose by hand. Tasks already started keep their people.`,
        'Apply')) return;
      busy(apply, true, 'Assigning…');
      try {
        const done = await rpc('auto_assign', { p_farm: farm.id, p_from: r.p_from, p_to: r.p_to });
        toast(`${done.assigned} of ${done.tasks} tasks assigned`, (done.unassigned || []).length ? 'bad' : 'ok');
        await reload();
      } catch (e) { busy(apply, false, 'Apply to the open tasks'); toast(e.message, 'bad'); }
    };
    row.append(apply);
  }
  c.append(row);
  return c;
}
