// ═══════════════════════════════════════════════════════════════════════════
// Procedures — what this FarmBox is supposed to do, and how (spec §7.5)
//
// Read only, and that is the design rather than an omission. Procedures are
// written in Notion and pulled across by the sync, and Notion owns the
// status: a procedure approved here would be quietly demoted on the next
// sync, so the console shows what is in force and sends you to Notion to
// change it.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, drawer, toast, num } from './ui.js';

const FAM = { Agriculture: 'fam-ag', Maintenance: 'fam-mt', Office: 'fam-of' };

let farm = null, data = null, mount = null, filter = { family: '', q: '' };

export async function renderProcedures(container, currentFarm) {
  farm = currentFarm; mount = container;
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
  const all = data.procedures;
  const shown = all.filter(p =>
    (!filter.family || p.family === filter.family) &&
    (!filter.q || (p.title + ' ' + (p.category || '')).toLowerCase().includes(filter.q)));

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a procedure';
  search.value = filter.q;
  search.oninput = () => { filter.q = search.value.trim().toLowerCase(); paint(); search.focus(); };
  search.style.minWidth = '220px';

  mount.append(pageHead('Procedures',
    `${all.length} in force. Written in Notion, synced here; the checklist a ` +
    'phone runs is the approved version of the procedure, frozen.',
    search));

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

  mount.append(table([
    { key: 'title', label: 'Procedure', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        return b; } },
    { key: 'family', label: 'Family', fmt: v => {
        const s = el('span', 'tag ' + (FAM[v] || ''), v);
        return s; } },
    // the same sub-family People › Responsible for and the planner use
    { key: 'category', label: 'Sub-family', fmt: v => v || '—' },
    { key: 'frequency', label: 'When', fmt: (v, r) =>
        [v, r.target === 'system' ? 'per bay' : r.target === 'area' ? 'per area' : null]
          .filter(Boolean).join(' · ') },
    { key: 'steps', label: 'Steps', align: 'right' },
    { key: 'minutes', label: 'Minutes', align: 'right', fmt: v => num(v) },
    { key: 'tasks_28d', label: 'Used 28 d', align: 'right' },
    { key: 'status', label: 'Status', fmt: (v, r) => {
        const s = el('span', 'pill' + (v === 'approved' ? ' ok' : ' warn'), v);
        if (!r.app_ready) s.title = 'Not marked App ready in Notion';
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
  fact('Repeats over', p.target === 'system' ? 'each bay'
                     : p.target === 'area' ? (p.area_kinds || []).join(', ') || 'each area'
                     : 'the whole FarmBox');
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
  if ((p.ppe || []).length || (p.tools || []).length) {
    d.body.append(el('div', 'sec-title', 'Before starting'));
    if ((p.ppe || []).length) d.body.append(el('p', 'hint', 'PPE: ' + p.ppe.join(', ')));
    if ((p.tools || []).length) d.body.append(el('p', 'hint', 'Tools: ' + p.tools.join(', ')));
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
  if (p.notion_page_id) {
    const a = el('a', 'btn btn-primary', 'Open in Notion');
    a.href = 'https://www.notion.so/' + String(p.notion_page_id).replace(/-/g, '');
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Editing and approving happen in Notion; the sync brings it back.';
    d.footer.append(a);
  } else {
    const n = el('span', 'hint', 'Approve and edit in Notion, then run the sync.');
    d.footer.append(n);
  }
}
