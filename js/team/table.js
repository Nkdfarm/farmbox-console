// Team page: the people table, one row per person, the order chips
import { rpc } from '../api.js';
import { employmentLabel, editPerson, personActions } from '../people.js';
import { el, selectBox, toast, avatar, subFamilyTag } from '../ui.js';
import { capacity, ctx, paint, profile, reload } from './index.js';
import { openAdd, openJob, openReplace } from './jobs.js';
import { openGlobal, openKey } from './priority.js';
import { S, DAY, first, fmtHours, keyLabel, roleLabel, which } from './state.js';

export function table(may) {
  const t = el('table', 'people team-table');
  const hr = el('tr');
  ['Person', 'Place in the job', 'Responsible for', which() === 'next' ? 'Next week' : 'This week', ''].forEach(h => hr.append(el('th', null, h)));
  const thead = el('thead'); thead.append(hr); t.append(thead);
  const tb = el('tbody');

  const all = S.T.people || [];
  const active = all.filter(p => p.active), off = all.filter(p => !p.active);
  const hp = new Map((S.hours?.people || []).map(x => [x.worker_id, x]));

  // every job the database lists, then any job it does not (so nobody is ever missing from the page)
  const listed = new Set((S.T.jobs || []).map(j => j.role));
  const jobs = [...(S.T.jobs || []), ...[...new Set(active.map(p => p.role))].filter(r => !listed.has(r)).map(r => ({ role: r, bundle: [], unlisted: true }))];
  jobs.forEach(job => {
    const ppl = active.filter(p => p.role === job.role);
    if (!ppl.length) return;
    const jr = el('tr', 'team-job');
    const jd = el('td'); jd.colSpan = 5;
    const line = el('div', 'team-jobline');
    line.append(el('b', null, roleLabel(job.role)), el('span', 'hint', ppl.length === 1 ? '1 person' : `${ppl.length} people`));
    if (job.role === 'ai_only') {
      // in the team only for their own AI (0242): no work, so nothing for the job to cover
      line.append(el('span', 'hint team-jobhas', 'In the team only for their own AI: no work, no hours. What it reads is set in their Edit window.'));
      if (may && S.AI) {
        const edit = el('button', 'btn btn-sm btn-ghost', 'Change…');
        edit.onclick = () => openJob(job);
        line.append(el('span', 'spacer'), edit);
      }
    } else if (may && !job.unlisted) {
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
    const b = el('button', 'btn btn-sm btn-ghost', (S.showOff ? '▾ ' : '▸ ') + `Switched off · ${off.length}`);
    b.onclick = () => { S.showOff = !S.showOff; paint(); };
    jd.append(b); jr.append(jd); tb.append(jr);
    if (S.showOff) off.forEach(p => tb.append(personRow(p, 0, may, hp.get(p.worker_id))));
  }
  t.append(tb);
  return t;
}

const tdOf = child => { const c = el('td'); if (child) c.append(child); return c; };

function personRow(p, inJob, may, h) {
  const tr = el('tr', 'team-row');
  if (!p.active) tr.classList.add('off');
  const prof = profile(p.worker_id);
  if (p.role === 'ai_only') return aiOnlyRow(tr, p, prof, may);

  const who = el('div', 'who');
  who.append(avatar({ ...p, photo_url: prof?.photo_url }));
  const names = el('div');
  names.append(el('b', null, [p.name, p.surname].filter(Boolean).join(' ')));
  const days = (p.working_days || []).map(d => DAY[d] || '').join('');
  names.append(el('small', null, `${employmentLabel(p.employment)} · ${days || 'no days'} · ${Number(p.hours_per_day)} h` + (p.has_login ? '' : ' · no login')));
  // off the task pages (0229, owner 12 Oct 2026): in the team, able to do any task on the phone, but not on the Tasks
  // board, not planned and never the owner of a task. A tick for whoever manages the people; a word for the others.
  if (p.active && may) {
    const lab = el('label', 'team-off');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!p.off_tasks;
    lab.title = 'Ticked: not on the Tasks board, not offered when work is assigned, not counted in the plan and never given a task as its owner. '
      + 'They still see every task on the phone and can do any of them; their name then shows on that task.';
    cb.onchange = async () => {
      cb.disabled = true;
      try {
        const r = await rpc('set_off_tasks', { p_worker: p.worker_id, p_on: cb.checked });
        const n = Number(r?.taken_off || 0);
        toast(cb.checked ? `${p.name} is off the task pages` + (n ? ` — ${n} planned task${n === 1 ? '' : 's'} went back to the plan` : '')
                         : `${p.name} is back on the task pages`, 'ok');
        await reload();
      } catch (e) { cb.checked = !cb.checked; cb.disabled = false; toast(String(e.message || e).replace(/^\d+ /, ''), 'bad'); }
    };
    lab.append(cb, 'Off the task pages');
    names.append(lab);
  } else if (p.off_tasks) names.append(el('small', 'team-off-word', 'off the task pages'));
  if (S.AI?.people.some(x => x.worker_id === p.worker_id && x.in_force)) names.append(el('span', 'team-ai-on', 'AI access on'));
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
    if (p.employment === 'casual') wk.append(el('span', 'hint', planned ? `on demand · ${fmtHours(planned)} planned` : 'on demand'));
    else {
      const bar = el('div', 'yd-bar' + (cap && planned > cap ? ' short' : ''));
      const f = el('i'); f.style.width = (cap ? Math.min(100, Math.round(100 * planned / cap)) : 0) + '%';
      bar.append(f);
      wk.append(bar, el('span', cap && planned > cap ? 'team-over' : '', `${fmtHours(planned)} of ${fmtHours(cap)}`));
    }
    const after = S.preview?.after?.[p.worker_id];
    if (S.preview) wk.append(el('div', 'team-then', `with this team: ${fmtHours(after?.minutes || 0)}`));
    if (Number(h?.clocked)) wk.append(el('div', 'hint', `worked ${fmtHours(h.clocked)}`));
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

// An AI-only person (0242): in the team only for their own AI — no responsibilities, days, hours or place
function aiOnlyRow(tr, p, prof, may) {
  const who = el('div', 'who');
  who.append(avatar({ ...p, photo_url: prof?.photo_url }));
  const names = el('div');
  names.append(el('b', null, [p.name, p.surname].filter(Boolean).join(' ')),
               el('small', null, 'AI only' + (prof?.email ? ' · ' + prof.email : ' · no e-mail yet')));
  who.append(names);
  if (S.AI?.people.some(x => x.worker_id === p.worker_id && x.in_force)) names.append(el('span', 'team-ai-on', 'AI access on'));
  tr.append(tdOf(who), tdOf(el('span', 'hint', '—')), tdOf(el('span', 'hint', 'no work — their AI reads what their Edit window allows')), tdOf(null));
  const acts = el('div', 'acts');
  if (may) {
    const edit = el('button', 'btn btn-sm', 'Edit');
    edit.onclick = () => editPerson(ctx(), prof || p);
    const more = el('button', 'btn btn-sm btn-ghost', '⋯');
    more.setAttribute('aria-label', 'More actions for ' + p.name);
    more.onclick = () => personActions(ctx(), prof || p);
    acts.append(edit, more);
  }
  tr.append(tdOf(acts));
  return tr;
}

// "Crop care 1" — the family in its colour, the number, a mark when the number was set by hand
export function chip(p, r, may) {
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
export function orderLine(list, before) {
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
export const sameOrder = (a, b) => (a || []).map(o => o.worker_id).join() === (b || []).map(o => o.worker_id).join();
