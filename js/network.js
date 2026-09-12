// ═══════════════════════════════════════════════════════════════════════════
// All FarmBoxes — the franchisor's screen (spec §7.11)
//
// One row per unit, and the numbers that say which one to help: how full it
// is, what it has harvested this month, whether last month's work actually
// got done, what is overdue, what is on fire, and whether next week is
// planned at all.
//
// It is the same function as everywhere else in the console, and row-level
// security decides how many rows come back: one for a farm manager, all of
// them for the franchisor. Clicking a farm switches the whole console to it.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, table, pageHead, card, num } from './ui.js';

let data = null, mount = null, onPick = null;

export async function renderNetwork(container, currentFarm, ctx) {
  mount = container;
  onPick = ctx?.switchFarm;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading every FarmBox…'));
  try { data = await rpc('farm_network', {}); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const farms = data.farms;
  const kg = farms.reduce((n, f) => n + Number(f.harvest_kg_month || 0), 0);
  const pos = farms.reduce((n, f) => n + Number(f.positions || 0), 0);
  const occ = farms.reduce((n, f) => n + Number(f.occupied || 0), 0);

  mount.append(pageHead('All FarmBoxes',
    `${farms.length} unit${farms.length === 1 ? '' : 's'} · ` +
    `${pos ? Math.round(100 * occ / pos) : 0}% of ${num(pos)} positions growing · ` +
    `${num(kg, 1)} kg harvested this month.`));

  if (!data.is_franchisor) {
    mount.append(el('div', 'note',
      'You are seeing the FarmBoxes you belong to. The franchisor sees every one.'));
  }

  if (data.alerts.length) {
    const a = card(`Worth a call · ${data.alerts.length}`);
    a.append(table([
      { key: 'farm', label: 'FarmBox' },
      { key: 'kind', label: 'What' },
      { key: 'detail', label: 'Detail' },
    ], data.alerts));
    mount.append(a);
  }

  mount.append(card('Every unit',
    table([
      { key: 'name', label: 'FarmBox', fmt: (v, r) => {
          const b = el('div');
          b.append(el('b', null, v));
          b.append(el('div', 'hint', [r.town, r.country].filter(Boolean).join(', ')));
          return b; } },
      { key: 'status', label: 'Status', fmt: v =>
          el('span', 'pill' + (v === 'active' ? ' ok' : ' warn'), v) },
      { key: 'occupancy_pct', label: 'Occupied', align: 'right', fmt: (v, r) => {
          const w = el('div', 'mini-bar');
          const f = el('div');
          f.style.width = Math.min(100, v) + '%';
          w.append(f);
          const box = el('div', 'mini-wrap');
          box.append(el('span', null, v + '%'), w);
          box.title = `${r.occupied} of ${r.positions} positions`;
          return box; } },
      { key: 'harvest_kg_month', label: 'Harvest, month', align: 'right',
        fmt: v => num(v, 1) + ' kg' },
      { key: 'completion_pct', label: 'Work done, 28 d', align: 'right', fmt: (v, r) =>
          v == null ? '—' : el('span', v >= 90 ? 'up' : v < 70 ? 'down' : null,
                               `${v}% of ${r.tasks_28d}`) },
      { key: 'overdue', label: 'Overdue', align: 'right', fmt: v =>
          v ? el('span', 'down', String(v)) : '—' },
      { key: 'critical_issues', label: 'Critical', align: 'right', fmt: (v, r) =>
          v ? el('span', 'pill bad', String(v)) : (r.open_issues || '—') },
      { key: 'plan_next_week', label: 'Next week', fmt: v =>
          el('span', 'pill' + (v === 'validated' || v === 'locked' ? ' ok'
                             : v === 'draft' ? ' warn' : ' bad'),
             v === 'none' ? 'not drafted' : v) },
      { key: 'quiet_days', label: 'Last seen', align: 'right', fmt: v =>
          v == null ? 'never' : v === 0 ? 'today' : `${v} d ago` },
    ], farms, {
      onRow: r => onPick && onPick(r.id),
      empty: 'No FarmBoxes visible to you.',
    })));

  mount.append(el('p', 'hint',
    'Click a unit to open it: the whole console switches to that FarmBox, ' +
    'with the same rights its manager has.'));
}
