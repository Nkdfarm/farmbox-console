// ═══════════════════════════════════════════════════════════════════════════
// Reports — the four weeks behind you (spec §7.10)
//
// Only the numbers that differ from what was expected are worth a manager's
// attention, so every table here has a "planned" column beside the "actual"
// one: yield against the plan, minutes against the estimate, steps that
// failed against runs that happened.
//
// Labour is deliberately manager-only, as the spec asks: task completion per
// person is a management tool, not a leaderboard.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, card, toast, num, shortDate } from './ui.js';

const RANGES = [[27, 'Last 4 weeks'], [6, 'Last week'], [90, 'Last quarter'],
                [364, 'Last year']];

let farm = null, data = null, mount = null, days = 27;

export async function renderReports(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// the period on screen, as the arguments it fetches with (app.js reads it ahead)
export function reportRange() {
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { p_from: ymd(from), p_to: ymd(new Date()) };
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Counting…'));
  try {
    data = await rpc('reports', { p_farm: farm.id, ...reportRange() });
  } catch (e) {
    mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return;
  }
  paint();
}

function paint() {
  mount.textContent = '';
  mount.append(pageHead('Reports',
    `${shortDate(data.from)} to ${shortDate(data.to)} · ` +
    `${num(data.harvest_total, 1)} kg harvested.`));

  const chips = el('div', 'chips');
  chips.style.marginBottom = 'var(--space-4)';
  RANGES.forEach(([d, label]) => {
    const c = el('button', 'chip' + (days === d ? ' on' : ''), label);
    c.onclick = () => { days = d; load(); };
    chips.append(c);
  });
  mount.append(chips);

  mount.append(card('Production against plan',
    table([
      { key: 'crop', label: 'Crop' },
      { key: 'kg', label: 'Harvested', align: 'right', fmt: v => num(v, 1) + ' kg' },
      { key: 'expected_kg', label: 'Planned', align: 'right',
        fmt: v => v ? num(v, 1) + ' kg' : '—' },
      { key: 'against_plan', label: 'Of plan', align: 'right', fmt: v =>
          v == null ? '—' : el('span', v >= 95 ? 'up' : v < 75 ? 'down' : null, v + '%') },
      { key: 'waste_kg', label: 'Waste', align: 'right',
        fmt: v => v ? num(v, 1) + ' kg' : '—' },
      { key: 'harvests', label: 'Cuts', align: 'right' },
    ], data.production, {
      empty: 'Nothing harvested in this period — or nothing recorded, which is the more likely of the two.',
    })));

  mount.append(card('Work, by family',
    table([
      { key: 'family', label: 'Family' },
      { key: 'planned', label: 'Planned', align: 'right' },
      { key: 'done', label: 'Done', align: 'right' },
      { key: 'skipped', label: 'Skipped', align: 'right', fmt: v => v || '—' },
      { key: 'open', label: 'Still open', align: 'right', fmt: (v) =>
          v ? el('span', 'down', String(v)) : '—' },
      { key: 'done', label: 'Completed', align: 'right', fmt: (v, r) =>
          r.planned ? Math.round(100 * v / r.planned) + '%' : '—' },
    ], data.tasks, { empty: 'No work in this period.' })));

  if (data.labour) {
    mount.append(card('Labour, by person',
      table([
        { key: 'worker', label: 'Person' },
        { key: 'tasks', label: 'Tasks', align: 'right' },
        { key: 'done', label: 'Done', align: 'right' },
        { key: 'estimated_minutes', label: 'Estimated', align: 'right',
          fmt: v => v ? num(v) + ' min' : '—' },
        { key: 'actual_minutes', label: 'Actual', align: 'right',
          fmt: v => v ? num(v) + ' min' : '—' },
        { key: 'against_estimate', label: 'Of estimate', align: 'right', fmt: v =>
            v == null ? '—' : el('span', v > 120 ? 'down' : v < 80 ? 'up' : null, v + '%') },
      ], data.labour, {
        empty: 'Nobody has a task in this period yet.',
      })));
  }

  mount.append(card('Procedures that fail',
    table([
      { key: 'procedure', label: 'Procedure' },
      { key: 'runs', label: 'Runs', align: 'right' },
      { key: 'failed_steps', label: 'Failed steps', align: 'right', fmt: v =>
          v ? el('span', 'down', String(v)) : '0' },
      { key: 'worst_step', label: 'Most often' },
    ], data.compliance, {
      empty: 'No checklist runs in this period.',
    })));

  mount.append(card('Issues',
    table([
      { key: 'raised', label: 'Raised', fmt: shortDate },
      { key: 'title', label: 'What happened' },
      { key: 'severity', label: 'Severity', fmt: v =>
          el('span', 'pill' + (v === 'critical' || v === 'high' ? ' bad' : ''), v) },
      { key: 'origin', label: 'From' },
      { key: 'status', label: 'Status' },
      { key: 'days_open', label: 'Days', align: 'right' },
    ], data.issues, { empty: 'No issues raised. Either a good month, or nobody is raising them.' })));
}
