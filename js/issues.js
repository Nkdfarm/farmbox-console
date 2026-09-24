// ═══════════════════════════════════════════════════════════════════════════
// Issues — what went wrong and is not fixed yet (spec §9, §7.1)
//
// Most issues raise themselves: a checklist step outside its range flags one
// and, where the step says so, creates the corrective task with it. The rest
// are typed by somebody who saw something. Either way an issue is open until
// a manager closes it, and the dashboard counts it while it is.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, table, pageHead, drawer, field, input, selectBox, confirmDrawer,
         toast, busy, shortDate } from './ui.js';

const SEVERITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'],
                  ['critical', 'Critical']];

let farm = null, data = null, mount = null, showClosed = false;

export async function renderIssues(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  await openFast([['issues', { p_farm: farm.id, p_include_closed: showClosed }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the issues…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

function paint() {
  mount.textContent = '';
  const open = data.issues.filter(i => i.status !== 'closed');
  const critical = open.filter(i => i.severity === 'critical').length;

  const raise = el('button', 'btn btn-primary', 'Raise an issue');
  raise.onclick = () => raiseIssue();

  mount.append(pageHead('Issues',
    open.length
      ? `${open.length} open${critical ? `, ${critical} critical` : ''}. ` +
        `The oldest has been open ${Math.max(...open.map(i => i.days_open))} days.`
      : 'Nothing open. Failed checklist steps land here on their own.',
    raise));

  const toggle = el('button', 'chip' + (showClosed ? ' on' : ''), 'Include closed');
  toggle.onclick = () => { showClosed = !showClosed; load(); };
  const chips = el('div', 'chips');
  chips.style.marginBottom = 'var(--space-4)';
  chips.append(toggle);
  mount.append(chips);

  mount.append(table([
    { key: 'title', label: 'What happened', fmt: (v, r) => {
        const b = el('div');
        b.append(el('b', null, v));
        const where = [r.asset, r.system, r.position].filter(Boolean).join(' · ');
        if (where) b.append(el('div', 'hint', where));
        // a pest case is followed in Pest & diseases › Cases (0097)
        if (r.kind === 'pest_case') {
          const a = el('a', 'linkish', 'pest case — open it in Pest & diseases');
          a.href = '#/ipm/scouting';
          b.append(el('div', 'hint')).append(a);
        }
        return b; } },
    { key: 'severity', label: 'Severity', fmt: v =>
        el('span', 'pill' + (v === 'critical' || v === 'high' ? ' bad'
                           : v === 'medium' ? ' warn' : ''), v) },
    { key: 'origin', label: 'Raised by' },
    { key: 'raised', label: 'When', fmt: v => shortDate(String(v).slice(0, 10)) },
    { key: 'days_open', label: 'Days', align: 'right' },
    { key: 'corrective_task', label: 'Corrective job' },
    { key: 'status', label: 'Status', fmt: (v, r) => {
        if (v === 'closed') return el('span', 'pill ok', 'closed');
        if (!data.may_close) return el('span', 'pill warn', v);
        const b = el('button', 'btn btn-sm', 'Close');
        b.onclick = e => { e.stopPropagation(); close(r); };
        return b; } },
  ], data.issues, {
    rowClass: r => r.status === 'closed' ? 'off' : '',
    empty: showClosed ? 'No issues at all.' : 'Nothing open.',
  }));
}

function raiseIssue() {
  const d = drawer('Raise an issue', 'Something that needs somebody to act');
  const title = input({ required: true, placeholder: 'Pump 2 is making a noise' });
  const detail = el('textarea');
  detail.rows = 4;
  detail.placeholder = 'What you saw, when, and anything already tried.';
  const severity = selectBox(SEVERITY, 'medium');

  d.body.append(field('What happened', title));
  d.body.append(field('Detail', detail));
  d.body.append(field('How bad', severity,
    'Critical is on the franchisor\'s screen within the hour.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Raise it');
  save.onclick = async () => {
    if (!title.value.trim()) { toast('It needs a title', 'bad'); return; }
    busy(save, true, 'Saving…');
    try {
      await rpc('raise_issue', { p: {
        farm_id: farm.id, title: title.value.trim(),
        detail: detail.value.trim(), severity: severity.value, origin: 'manual' } });
      d.close();
      toast('Raised', 'ok');
      await load();
    } catch (e) { busy(save, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}

async function close(row) {
  const d = drawer('Close the issue', row.title);
  const note = el('textarea');
  note.rows = 3;
  note.placeholder = 'What was done about it.';
  d.body.append(field('What fixed it', note,
    'Kept with the issue: the next person to see this fault reads it.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const ok = el('button', 'btn btn-primary', 'Close it');
  ok.onclick = async () => {
    busy(ok, true, 'Closing…');
    try {
      await rpc('close_issue', { p_id: row.id, p_note: note.value.trim() || null });
      d.close();
      toast('Closed', 'ok');
      await load();
    } catch (e) { busy(ok, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, ok);
}
