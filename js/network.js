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
import { el, table, pageHead, card, drawer, field, input, selectBox,
         toast, busy, num } from './ui.js';

let data = null, mount = null, onPick = null, reloadFarms = null;

export async function renderNetwork(container, currentFarm, ctx) {
  mount = container;
  onPick = ctx?.switchFarm;
  reloadFarms = ctx?.reloadFarms;
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

  const add = el('button', 'btn btn-primary', 'Commission a FarmBox');
  add.title = 'Steps 1–3 of the wizard: the unit and its configuration from a model.';
  add.onclick = () => commission();

  mount.append(pageHead('All FarmBoxes',
    `${farms.length} unit${farms.length === 1 ? '' : 's'} · ` +
    `${pos ? Math.round(100 * occ / pos) : 0}% of ${num(pos)} positions growing · ` +
    `${num(kg, 1)} kg harvested this month.`,
    data.is_franchisor ? add : null));

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

// ── §7.13 steps 1–3: the unit, and its configuration from a model ─────────
// The other four steps are screens that already exist, so the wizard hands
// over to them by name rather than growing a second copy of each.
async function commission() {
  let models = [];
  try { models = await rpc('farm_models', {}); }
  catch (e) { toast(e.message, 'bad'); return; }
  if (!models.length) { toast('No FarmBox models to build from', 'bad'); return; }

  const d = drawer('Commission a FarmBox', 'Steps 1 to 3 of the wizard (§7.13)');

  const name = input({ required: true, placeholder: 'FarmBox Soweto' });
  const code = input({ required: true, placeholder: 'SOW1', maxLength: 8 });
  const org = input({ placeholder: 'who runs it' });
  const town = input({ placeholder: 'Soweto' });
  const country = selectBox(COUNTRIES.map(c => [c[0], c[1]]), 'ZA');
  const model = selectBox(models.map(m =>
    [m.code, `${m.name} · ${m.zones} zones, ${m.recipes} recipes, ${m.cycles} cycles`]),
    models[0].code);

  d.body.append(field('Name', name));
  d.body.append(field('Short code', code, 'Goes in front of every zone and batch code.'));
  d.body.append(field('Franchisee', org, 'The organisation that runs it.'));
  d.body.append(field('Country', country,
    'Decides the price book, the currency and which way round the seasons run.'));
  d.body.append(field('Town', town));
  d.body.append(field('Model', model,
    'Its default configuration becomes the zones, systems and positions — all of it ' +
    'editable afterwards on Farm setup.'));

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Commission it');
  go.onclick = async () => {
    if (!name.value.trim() || !code.value.trim()) {
      toast('It needs a name and a code', 'bad'); return;
    }
    busy(go, true, 'Building it…');
    try {
      const r = await rpc('commission_farm', { p: {
        name: name.value.trim(), code: code.value.trim(),
        org_name: org.value.trim() || name.value.trim(),
        country_code: country.value, town: town.value.trim(),
        model_code: model.value } });
      d.close();
      toast(`${r.name}: ${r.zones} zones, ${r.systems} systems, ${r.positions} positions`, 'ok');
      done(r);
    } catch (e) { busy(go, false); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

function done(r) {
  const d = drawer(r.name + ' is commissioned', `${r.code} · from model ${r.model}`);
  const facts = el('div', 'facts');
  [['Zones', r.zones], ['Systems', r.systems], ['Positions', r.positions],
   ['Areas', r.areas], ['Currency', r.currency], ['Country', r.country]]
    .forEach(([k, v]) => {
      const f = el('div', 'fact');
      f.append(el('span', 'fact-k', k), el('span', 'fact-v', String(v)));
      facts.append(f);
    });
  d.body.append(facts);
  d.body.append(el('p', null,
    'Every count above is the model’s default. The unit is in setup, not active, ' +
    'until somebody says otherwise.'));
  d.body.append(el('div', 'sec-title', 'What only a person can do'));
  const ol = el('ol', 'steps');
  (r.next || []).forEach(x => ol.append(el('li', null, x)));
  d.body.append(ol);

  const ok = el('button', 'btn btn-primary', 'Open it');
  ok.onclick = async () => {
    d.close();
    // the switcher has never heard of this farm yet
    if (reloadFarms) await reloadFarms();
    await load();
    if (onPick) onPick(r.farm_id);
  };
  const later = el('button', 'btn', 'Later');
  later.onclick = () => { d.close(); load(); };
  d.footer.append(later, ok);
}

// The price book covers the G20 (§10.4); a FarmBox anywhere else needs its
// country added to price_country first, and the call says so rather than
// quietly pricing everything in South Africa.
const COUNTRIES = [
  ['ZA', 'South Africa'], ['AR', 'Argentina'], ['AU', 'Australia'], ['BR', 'Brazil'],
  ['CA', 'Canada'], ['CN', 'China'], ['DE', 'Germany'], ['FR', 'France'],
  ['GB', 'United Kingdom'], ['ID', 'Indonesia'], ['IN', 'India'], ['IT', 'Italy'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['MX', 'Mexico'], ['RU', 'Russia'],
  ['SA', 'Saudi Arabia'], ['TR', 'Türkiye'], ['US', 'United States'],
];
