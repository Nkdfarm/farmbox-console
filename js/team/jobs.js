// Team page: the Jobs windows (replace, add, the list, one job)
import { rpc } from '../api.js';
import { jobAiSection } from '../team-ai.js';
import { el, field, selectBox, toast, drawer, busy, subFamilyTag, farmToday } from '../ui.js';
import { families, reload } from './index.js';
import { S, first, roleLabel } from './state.js';
import { chip } from './table.js';

// ── a replacement ───────────────────────────────────────────────────────────
export function openReplace(p) {
  const others = (S.T.people || []).filter(x => x.active && !x.off_tasks && x.worker_id !== p.worker_id);
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
    el('div', 'hint team-hint', `${p.name} stays on the team until you switch them off (⋯ › Switch off).`));
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
export function openAdd(p) {
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
export function openJobs() {
  const d = drawer('Jobs', 'What each job is responsible for at ' + S.farm.name + '. Everybody with the job gets it.');
  (S.T.jobs || []).filter(job => job.role !== 'ai_only').forEach(job => {   // AI only covers no work (0242)
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
    'Across jobs the order is: Farm manager, Farm assistant, Agronomist, Technician, Worker, Student, Office, Admin — then the place in the job. A number set by hand on a label wins over both.'));
  const close = el('button', 'btn', 'Close'); close.onclick = d.close;
  d.footer.append(close);
}

export function openJob(job) {
  const onlyAi = job.role === 'ai_only';        // no work: only what their AI may read (0.7.265)
  const d = drawer(roleLabel(job.role), onlyAi ? 'In the team only for their own AI.' : 'What this job is responsible for. Everybody with the job follows.');
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
  if (!onlyAi) draw();
  // what the AI of the people of this job may read, when their AI access is ticked (0242)
  const ai = S.AI ? jobAiSection(S.AI, job.role) : null;
  if (ai) d.body.append(ai.node);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try {
      const rows = [...chosen].map(k => { const [family, category] = k.split('|'); return { family, category: category || '' }; });
      if (!onlyAi) await rpc('team_save_bundle', { p_farm: S.farm.id, p_role: job.role, p_rows: rows });
      await ai?.save();
      d.close(); toast(`${roleLabel(job.role)}: saved`, 'ok'); await reload();
    } catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}
