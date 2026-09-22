// ═══════════════════════════════════════════════════════════════════════════
// Procedures — what this FarmBox is supposed to do, and how (spec §7.5)
//
// Edited here since console 0.7.47 (migration 0056): the console owns the
// procedures and the Notion sync leaves them alone. Details change in place;
// a changed checklist becomes a new approved version (the one a phone already
// runs is never edited in place), and tasks not yet started move onto it.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, drawer, toast, num, subFamilyTag, systemLabel } from './ui.js';
import { editProcedure } from './procedure-edit.js';

const FAM = { Agriculture: 'fam-ag', Maintenance: 'fam-mt', Office: 'fam-of' };

let farm = null, data = null, mount = null, filter = { family: '', q: '' };
// a library (0.7.70): one family's procedures under its own section — Grow ›
// Routines, IPM › Programs, Office › Farm management, Maintenance › Preventive.
// `keep` says which procedures belong; "Every procedure" widens it on demand.
let lib = null, showAll = false;

export async function renderProcedures(container, currentFarm, library = null) {
  farm = currentFarm; mount = container;
  if (library !== lib) { showAll = false; filter = { family: '', q: '' }; }
  lib = library;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the procedures…'));
  try { data = await rpc('procedures', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const all = lib && !showAll ? data.procedures.filter(lib.keep) : data.procedures;
  const shown = all.filter(p =>
    (!filter.family || p.family === filter.family) &&
    (!filter.q || (p.title + ' ' + (p.category || '')).toLowerCase().includes(filter.q)));

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a procedure';
  search.value = filter.q;
  search.oninput = () => { filter.q = search.value.trim().toLowerCase(); paint(); search.focus(); };
  search.style.minWidth = '220px';

  const widen = lib ? el('button', 'btn btn-sm btn-ghost', showAll ? `Back to ${lib.title}` : 'Every procedure') : null;
  if (widen) widen.onclick = () => { showAll = !showAll; filter.family = ''; paint(); };
  mount.append(pageHead(lib && !showAll ? lib.title : 'Procedures',
    (lib && !showAll ? lib.blurb + ' ' : '') +
    `${all.length} in force. Open one and press Edit to change it; a changed checklist ` +
    'becomes a new approved version, and the phone runs that one from the next task.',
    search, widen));

  if (!lib || showAll) {
    const chips = el('div', 'chips');
    chips.style.marginBottom = 'var(--space-4)';
    const add = (label, value, n) => {
      const c = el('button', 'chip' + (filter.family === value ? ' on' : ''),
                   n == null ? label : `${label} · ${n}`);
      c.onclick = () => { filter.family = value; paint(); };
      chips.append(c);
    };
    add('Everything', '', all.length);
    data.families.forEach(f => add(f.family, f.family, f.n));
    mount.append(chips);
  }

  mount.append(table([
    { key: 'title', label: 'Procedure', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        return b; } },
    { key: 'family', label: 'Family', fmt: v => {
        const s = el('span', 'tag ' + (FAM[v] || ''), v);
        return s; } },
    // the same sub-family People › Responsible for and the planner use
    { key: 'category', label: 'Sub-family', fmt: v => subFamilyTag(v) },
    { key: 'frequency', label: 'When', fmt: (v, r) =>
        [v, r.target === 'system' ? 'per bay' : r.target === 'area' ? 'per area'
              : r.target === 'crop' ? 'per crop' : r.target === 'position' ? 'per batch' : null]
          .filter(Boolean).join(' · ') },
    { key: 'steps', label: 'Steps', align: 'right' },
    { key: 'minutes', label: 'Minutes', align: 'right', fmt: v => num(v) },
    { key: 'tasks_28d', label: 'Used 28 d', align: 'right' },
    { key: 'status', label: 'Status', fmt: (v, r) => {
        const s = el('span', 'pill' + (v === 'approved' ? ' ok' : ' warn'), v);
        if (!r.app_ready) s.title = 'Not marked App ready — the phone does not show it';
        return s; } },
  ], shown, {
    onRow: r => openProcedure(r),
    empty: filter.q ? 'No procedure matches that.' : 'No procedures yet — run the Notion sync.',
  }));
}

async function openProcedure(row) {
  const d = drawer(row.title, `${row.family}${row.category ? ' · ' + row.category : ''}`);
  d.body.append(el('div', 'empty', 'Reading…'));

  let p;
  try { p = await rpc('procedure', { p_sop: row.id, p_farm: farm.id }); }
  catch (e) { d.body.textContent = ''; d.body.append(el('div', 'note bad', e.message)); return; }

  d.body.textContent = '';
  const facts = el('div', 'facts');
  const fact = (k, v) => {
    const f = el('div', 'fact');
    f.append(el('span', 'fact-k', k), el('span', 'fact-v', v ?? '—'));
    facts.append(f);
  };
  fact('Version', p.version);
  fact('Status', p.status + (p.app_ready ? ' · app ready' : ''));
  fact('Frequency', p.frequency);
  fact('Time of day', { am: 'Morning', pm: 'Afternoon' }[p.slot] || 'Anytime');
  fact('Repeats over', p.target === 'system' ? 'each bay'
                     : p.target === 'area' ? (p.area_kinds || []).join(', ') || 'each area'
                     : p.target === 'crop' ? 'each crop in each bay'
                     : p.target === 'position' ? 'each batch'
                     : 'the whole FarmBox' + ((p.area_kinds || []).length ? ' · ' + p.area_kinds.join(', ') : ''));
  if (p.variant_of) fact('Variant of', data.procedures.find(x => x.id === p.variant_of)?.title || '—');
  const variants = data.procedures.filter(x => x.variant_of === p.id && x.status === 'approved');
  if (variants.length) fact('Variants', variants.map(x => `${x.title} (${(x.systems || []).map(systemLabel).join(', ')})`).join(' · '));
  fact('Minutes', p.minutes_per_unit
        ? `${p.minutes} + ${p.minutes_per_unit}/${p.unit || 'unit'}` : p.minutes);
  fact('People', p.min_workers);
  if ((p.rotate_among || []).length) fact('Rotates among', p.rotate_among.join(', '));
  if ((p.skills || []).length) fact('Skills', p.skills.join(', '));
  fact('Runs, 28 d', `${p.runs_28d}${p.fails_28d ? ` · ${p.fails_28d} failed steps` : ''}`);
  d.body.append(facts);

  if (p.purpose) {
    d.body.append(el('div', 'sec-title', 'Purpose'));
    d.body.append(el('p', null, p.purpose));
  }
  // PPE and tools are free text in the database, not lists
  const list = v => Array.isArray(v) ? v
    : (v ? String(v).split(/[,;\n]/).map(x => x.trim()).filter(Boolean) : []);
  const ppe = list(p.ppe), tools = list(p.tools);
  if (ppe.length || tools.length) {
    d.body.append(el('div', 'sec-title', 'Before starting'));
    if (ppe.length) d.body.append(el('p', 'hint', 'PPE: ' + ppe.join(', ')));
    if (tools.length) d.body.append(el('p', 'hint', 'Tools: ' + tools.join(', ')));
  }

  d.body.append(el('div', 'sec-title', `Checklist — version ${p.version}, frozen`));
  const steps = el('ol', 'steps');
  p.steps.forEach(s => {
    const li = el('li');
    li.append(el('b', null, s.title));
    if (s.instruction) li.append(el('div', 'hint', s.instruction));
    const meta = [];
    if (s.type && s.type !== 'check') meta.push(s.type);
    if (s.min != null || s.max != null) {
      meta.push(`${s.min ?? ''}–${s.max ?? ''} ${s.unit || ''}`.trim());
    }
    if (s.evidence && s.evidence !== 'none') meta.push(s.evidence + ' required');
    if (s.critical) meta.push('critical');
    if (meta.length) li.append(el('div', 'step-meta', meta.join(' · ')));
    steps.append(li);
  });
  if (!p.steps.length) steps.append(el('li', 'hint', 'No steps in this version.'));
  d.body.append(steps);

  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
  if (p.may_edit) {
    const edit = el('button', 'btn btn-primary', 'Edit');
    edit.onclick = () => {
      d.close();
      const cats = [...new Set((data?.procedures || []).map(x => x.category).filter(Boolean))].sort();
      editProcedure(p, cats, load, data.procedures);
    };
    d.footer.append(edit);
  } else {
    d.footer.append(el('span', 'hint', 'Only the franchisor edits a standard procedure.'));
  }
}
