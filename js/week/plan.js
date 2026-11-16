// the Friday plan drawer: roster, load, exceptions, Draft and Validate
import { drawer, el, parseYmd, once, confirmDrawer, toast, busy, avatar } from '../ui.js';
import { rpc } from '../api.js';
import { roleLabel } from '../people.js';
import { focusWeek, load } from './index.js';
import { weeks, shift, hrs, longDate, DAYS, S } from './state.js';
import { cell } from './chip.js';

// ── the Friday plan, in its window ─────────────────────────────────────────
export function planDrawer() {
  const wk = focusWeek();
  S.data = weeks.get(wk);
  const plan = S.data?.plan, may = S.data?.may_plan;
  const end = shift(wk, 6);
  const f = s => parseYmd(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const d = drawer(`The plan for ${f(wk)} – ${f(end)}`,
    'The planner proposes a name against every task from the roster, who is away, who is responsible for what and who holds which skill. Change what you disagree with on the board, then validate.');
  d.box.style.width = 'min(820px, 100vw)';
  d.body.append(summary(plan));
  if (!plan) {
    const e = el('div', 'empty');
    e.append(el('h3', null, 'No plan for this week yet'));
    e.append(el('p', null, may ? 'Draft one and the planner proposes the whole week in a second.' : 'A manager of this FarmBox drafts it.'));
    d.body.append(e);
  } else {
    const exceptions = plan.exceptions || [];
    if (exceptions.length) d.body.append(exceptionsCard(exceptions));
    d.body.append(el('div', 'sec-title', 'Who is on, and how full they are'));
    d.body.append(rosterCard());
  }
  if (may) {
    // a validated week is a record, not a lock (FarmBox 0212): it is drafted again after a yes, which reopens it
    const redo = el('button', 'btn', plan ? 'Draft again' : 'Draft the week');
    redo.onclick = () => once(redo, async () => {
      if (plan && plan.status !== 'draft') {
        if (!await confirmDrawer('Draft the validated week again?',
          'The week goes back to a draft and the planner proposes every name again. Tasks somebody has already started keep their people.', 'Draft again')) return;
        try { await rpc('reopen_labour_plan', { p_plan: plan.id }); } catch (e) { toast(e.message, 'bad'); return; }
      }
      await draft(redo, d);
    });
    d.footer.append(redo);
    if (plan?.status === 'draft') {
      const ok = el('button', 'btn btn-primary', 'Validate the week');
      ok.onclick = async () => {
        const exc = (plan.exceptions || []).filter(e => e.kind === 'unassigned').length;
        if (exc && !await confirmDrawer('Validate with gaps?',
          `${exc} task${exc === 1 ? ' has' : 's have'} nobody against ${exc === 1 ? 'it' : 'them'}. ` +
          'You can validate anyway — the gaps stay visible — or close the window and fix them first.', 'Validate anyway')) return;
        busy(ok, true, 'Validating…');
        try {
          await rpc('validate_labour_plan', { p_plan: plan.id });
          toast('The week is validated', 'ok');
          d.close(); await load();
        } catch (e) { busy(ok, false, 'Validate the week'); toast(e.message, 'bad'); }
      };
      d.footer.append(ok);
    } else if (plan) d.footer.append(el('span', 'pill ok', plan.status === 'locked' ? 'Locked' : 'Validated'));
  }
  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(close);
}

function summary(plan) {
  const row = el('div', 'row');
  row.style.margin = '0 0 var(--space-4)';
  const pill = (t, k) => row.append(el('span', 'pill ' + (k || ''), t));
  if (!plan) { pill('Not drafted', 'warn'); return row; }
  const cap = Number(plan.capacity_minutes || 0), dem = Number(plan.demand_minutes || 0);
  const pct = cap ? Math.round((dem / cap) * 100) : 0;
  pill(plan.status === 'validated' ? 'Validated' : plan.status === 'locked' ? 'Locked' : 'Draft', plan.status === 'draft' ? 'warn' : 'ok');
  pill(`${hrs(dem)} h of work`);
  pill(`${hrs(cap)} h of people`);
  pill(`${pct}% loaded`, pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok');
  if (plan.validated_at) pill('validated ' + new Date(plan.validated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  return row;
}

// what the planner could not solve: one line per reason, not one per task
function exceptionsCard(list) {
  const groups = new Map();
  for (const e of list) {
    const key = `${e.kind}|${e.reason}|${e.date || ''}`;
    if (!groups.has(key)) groups.set(key, { ...e, n: 0, titles: [] });
    const g = groups.get(key); g.n++; if (e.title) g.titles.push(e.title);
  }
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.style.borderLeft = '4px solid var(--warning)';
  card.append(el('b', null, `${list.length} thing${list.length === 1 ? '' : 's'} the planner could not settle`));
  card.append(el('div', 'hint', 'These are not errors — they are the week telling you something. Nothing is hidden or dropped.'));
  const box = el('div', 'resp');
  box.style.marginTop = 'var(--space-3)';
  for (const g of groups.values()) {
    const line = el('div', 'note ' + (g.kind === 'unassigned' ? 'warn' : ''));
    line.append(el('b', null, g.date ? longDate(g.date) + ' — ' : ''));
    line.append(document.createTextNode(g.reason));
    if (g.n > 1) line.append(el('span', 'pill', ` ${g.n} tasks`));
    if (g.titles.length) line.append(el('div', 'hint', g.titles.slice(0, 6).join(' · ') + (g.titles.length > 6 ? ` and ${g.titles.length - 6} more` : '')));
    box.append(line);
  }
  card.append(box);
  return card;
}

function rosterCard() {
  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people');
  const thead = el('thead'); const hr = el('tr');
  ['Slot', 'Person', 'Days', 'Capacity', 'Planned', 'Load'].forEach(x => hr.append(el('th', null, x)));
  thead.append(hr); t.append(thead);
  const tb = el('tbody');
  (S.data?.roster || []).forEach((r, i) => {
    const tr = el('tr');
    tr.append(cell(el('span', 'mono', 'Worker ' + (i + 1))));
    const who = el('div', 'who');
    who.append(avatar(r));
    const names = el('div'); names.append(el('b', null, r.name)); names.append(el('small', null, roleLabel(r.role)));
    who.append(names);
    tr.append(cell(who));
    tr.append(cell(el('span', 'mono', (r.days || []).map(d => DAYS[d - 1][0]).join(''))));
    tr.append(cell(el('span', 'mono', hrs(r.minutes) + ' h')));
    tr.append(cell(el('span', 'mono', hrs(r.planned) + ' h')));
    const pct = Number(r.minutes) ? Math.round((Number(r.planned) / Number(r.minutes)) * 100) : 0;
    tr.append(cell(el('span', 'pill ' + (pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'ok'), pct + '%')));
    tb.append(tr);
  });
  if (!(S.data?.roster || []).length) {
    const tr = el('tr'); const td = el('td'); td.colSpan = 6;
    td.append(el('div', 'empty', 'Nobody is rostered this week.'));
    tr.append(td); tb.append(tr);
  }
  t.append(tb); wrap.append(t);
  return wrap;
}

async function draft(button, d) {
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('draft_labour_plan', { p_farm: S.farm.id, p_week: focusWeek() });
    toast(`${r.demand_hours} h placed across ${r.slots} people`, 'ok');
    d?.close(); await load();
  } catch (e) {
    busy(button, false, 'Draft the week');
    toast(e.message, 'bad');
  }
}
