// ═══════════════════════════════════════════════════════════════════════════
// Farm setup — what this FarmBox is, before anything else (spec §7.12, §7.13)
//
// Step one of commissioning and the page you come back to when something about
// the unit changes: which market it sells into, what it quotes in, who it
// normally sells to, and which days anyone is on site. Everything downstream
// reads these — the price book picks a country and a hemisphere from here, and
// the task generator picks its working days.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc } from './api.js';
import { el, field, input, selectBox, toast, busy, drawer, SYSTEM_TYPES } from './ui.js';
import { locationPicker, forecastLinks, readFarm } from './weather.js';

const DAYS = [[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[7,'Sun']];
const CHANNELS = [['direct','Direct to the consumer'], ['retail','To a retailer']];

let farm = null, data = null, mount = null;

export async function renderFarm(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

async function load() {
  mount.textContent = '';
  mount.append(el('div', 'empty', 'Reading the setup…'));
  try { data = await rpc('farm_market', { p_farm: farm.id }); }
  catch (e) { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); return; }
  paint();
}

function paint() {
  mount.textContent = '';
  const may = data.may_edit;

  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('h1', null, data.name));
  titles.append(el('p', null,
    'What this FarmBox is. The price book takes its market and its seasons from ' +
    'here, and the task generator takes the days somebody is on site.'));
  head.append(titles, el('div', 'spacer'));
  head.append(el('span', 'pill', data.code));
  mount.append(head);

  if (!data.country_code) {
    mount.append(el('div', 'note warn',
      'No market chosen yet, so every price falls back to South Africa. ' +
      'Pick one below and the whole price book follows.'));
  }

  mount.append(marketCard(may));
  mount.append(locationCard(may));
  mount.append(weekCard(may));
  mount.append(zonesCard(may));
}

// ── the market ─────────────────────────────────────────────────────────────
function marketCard(may) {
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.append(el('div', 'sec-title', 'Market'));

  const country = selectBox(
    (data.markets || []).map(m => [m.code, `${m.name} · ${m.currency}`]),
    data.country_code || 'ZA');
  country.id = 'f-country';

  const currency = input({ id: 'f-currency', value: data.currency || '',
                           maxLength: 3, style: 'text-transform:uppercase' });
  const channel = selectBox(CHANNELS, data.default_channel || 'direct');
  channel.id = 'f-channel';

  const hint = el('div', 'hint');
  const setHint = () => {
    const m = (data.markets || []).find(x => x.code === country.value);
    if (!m) { hint.textContent = ''; return; }
    hint.textContent = `${m.name} sits in the ${m.hemisphere} hemisphere, so its `
      + `seasons run that way. Its own currency is ${m.currency}`
      + (currency.value.toUpperCase() !== m.currency
          ? ` — you are quoting in ${currency.value.toUpperCase() || '—'} instead.` : '.');
  };
  country.onchange = () => {
    const m = (data.markets || []).find(x => x.code === country.value);
    if (m) currency.value = m.currency;      // follow the country unless overridden
    setHint();
  };
  currency.oninput = setHint;

  const grid = el('div', 'grid3');
  grid.append(field('Country', country),
              field('Currency', currency, 'Three letters. Defaults to the country’s.'),
              field('Normally sells', channel));
  card.append(grid, hint);

  if (data.season_now) {
    const p = el('div', 'row');
    p.style.marginTop = 'var(--space-3)';
    p.append(el('span', 'pill ok', 'It is ' + data.season_now + ' there now'));
    p.append(el('span', 'hint',
      'Which is the season the planner values a harvest at, unless the harvest lands in the next one.'));
    card.append(p);
  }

  if (may) {
    const row = el('div', 'row');
    row.style.marginTop = 'var(--space-4)';
    const save = el('button', 'btn btn-primary', 'Save the market');
    save.onclick = async () => {
      const cur = currency.value.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) { toast('A currency is three letters, like ZAR', 'bad'); return; }
      busy(save, true, 'Saving…');
      try {
        await rpc('set_farm_market', { p_farm: farm.id, p_country: country.value,
                                       p_currency: cur, p_channel: channel.value });
        toast('Market saved', 'ok');
        await load();
      } catch (e) { busy(save, false, 'Save the market'); toast(e.message, 'bad'); }
    };
    row.append(save);
    card.append(row);
  }
  setHint();
  return card;
}

// ── where it is ────────────────────────────────────────────────────────────
// The dashboard's weather is read for this place. The same town search as the
// weather tile, so there is one way to set it wherever somebody looks for it.
function locationCard(may) {
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.append(el('div', 'sec-title', 'Location'));
  const body = el('div');
  card.append(body);

  const show = async () => {
    body.textContent = '';
    body.append(el('div', 'hint', 'Reading the location…'));
    let row;
    try { row = await readFarm(farm.id); }
    catch (e) { body.textContent = ''; body.append(el('div', 'note bad', e.message)); return; }
    body.textContent = '';

    const now = el('div', 'row');
    now.style.marginTop = 'var(--space-2)';
    if (row.lat == null || row.lng == null) {
      now.append(el('span', 'pill warn', 'Not set — the dashboard shows no weather yet'));
    } else {
      now.append(el('span', 'pill ok', row.town || 'Set'));
      now.append(el('span', 'mono', `${Number(row.lat).toFixed(4)}, ${Number(row.lng).toFixed(4)}`));
      now.append(forecastLinks(row));
    }
    body.append(now);
    body.append(el('div', 'hint',
      'The weather on the dashboard — sky, rain and wind — is read for this place. ' +
      'Type the nearest town and pick it from the list; the province is shown so two places with one name cannot be confused.'));
    if (may) {
      const picker = locationPicker(row, { onSaved: () => show() });
      picker.style.marginTop = 'var(--space-3)';
      body.append(picker);
    }
  };
  show();
  return card;
}

// ── the week ───────────────────────────────────────────────────────────────
function weekCard() {
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.append(el('div', 'sec-title', 'The week'));

  const days = el('div', 'row');
  days.style.marginTop = 'var(--space-2)';
  const on = new Set(data.operating_days || []);
  DAYS.forEach(([n, label]) => {
    const b = el('span', 'toggle', label);
    b.setAttribute('aria-pressed', String(on.has(n)));
    days.append(b);
  });
  card.append(days);
  card.append(el('div', 'hint',
    'The days somebody is on site. Daily work is only generated on these; the weekend ' +
    'is covered by the remote check instead. Change it on the People page for now.'));

  const p = el('div', 'row');
  p.style.marginTop = 'var(--space-3)';
  p.append(el('span', 'pill',
    'Plan validated ' + (DAYS[(data.planning_weekday || 5) - 1]?.[1] ?? '?')
    + ' at ' + String(data.planning_time || '14:00').slice(0, 5)));
  p.append(el('span', 'pill', data.timezone || ''));
  card.append(p);
  return card;
}

// ── what it is made of ─────────────────────────────────────────────────────
const TYPES = SYSTEM_TYPES;
const MEDIA = [['net_cup','Net cup'],['pot','Pots'],['tray','Trays'],['rockwool','Rockwool'],['slab','Slab / bucket']];
const CATS  = [['leafy','Leafy'],['mixed_leafy','Mixed leafy'],['herbs','Herbs'],['microgreens','Microgreens'],
               ['vines','Vines'],['fruiting','Fruiting']];
const STATUS = [['active','Active'],['maintenance','In maintenance'],['out_of_service','Out of service']];
const label = (list, v) => (list.find(x => x[0] === v) || [v, v])[1];

function zonesCard(may) {
  const card = el('div', 'card');
  const head = el('div', 'row');
  head.style.padding = 'var(--space-3) var(--space-4)';
  head.style.borderBottom = '1px solid var(--border)';
  head.append(el('b', null, 'Growing zones'));
  const tot = (data.zones || []).reduce((a, z) => a + Number(z.plants || 0), 0);
  head.append(el('span', 'pill', `${(data.zones || []).length} zones · ${tot.toLocaleString()} places`));
  if (may) head.append(el('span', 'hint', 'Click a zone to change it.'));
  card.append(head);

  const wrap = el('div', 'table-wrap');
  const t = el('table', 'people');
  const thead = el('thead'); const hr = el('tr');
  const cols = ['Zone','System','Medium','Positions','Places','Area','In use'];
  if (may) cols.push('');
  cols.forEach(h => hr.append(el('th', null, h)));
  thead.append(hr); t.append(thead);

  const tb = el('tbody');
  (data.zones || []).forEach(z => {
    const tr = el('tr');
    const c = x => { const d = el('td'); d.append(x); return d; };
    tr.append(c(el('b', null, z.name)));
    tr.append(c(el('span', 'chip', label(TYPES, z.type))));
    tr.append(c(el('span', null, (z.media || []).map(m => label(MEDIA, m)).join(', ') || '—')));
    tr.append(c(el('span', 'mono', String(z.positions))));
    tr.append(c(el('span', 'mono', Number(z.plants).toLocaleString())));
    tr.append(c(el('span', 'mono', z.area_m2 ? Number(z.area_m2) + ' m²' : '—')));
    const pct = z.positions ? Math.round((z.occupied / z.positions) * 100) : 0;
    tr.append(c(el('span', 'pill ' + (pct === 100 ? 'ok' : pct === 0 ? 'warn' : ''),
                   `${z.occupied} of ${z.positions}`)));
    if (may) {
      const b = el('button', 'btn btn-sm', 'Edit');
      if (z.id) {
        b.onclick = e => { e.stopPropagation(); editZone(z); };
        tr.style.cursor = 'pointer';
        tr.onclick = () => editZone(z);
      } else {
        b.disabled = true;
        b.title = 'The database needs the 0050 update first.';
      }
      tr.append(c(b));
    }
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); card.append(wrap);
  return card;
}

// A row of on/off buttons over a set of values; .value() reads the choice.
function toggles(options, chosen) {
  const on = new Set(chosen || []);
  const row = el('div', 'row');
  row.style.flexWrap = 'wrap';
  options.forEach(([v, text]) => {
    const b = el('button', 'toggle', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on.has(v)));
    b.onclick = () => {
      if (on.has(v)) on.delete(v); else on.add(v);
      b.setAttribute('aria-pressed', String(on.has(v)));
    };
    row.append(b);
  });
  row.value = () => options.map(o => o[0]).filter(v => on.has(v));
  return row;
}

// ── change one zone ────────────────────────────────────────────────────────
// Everything a zone is: its name, system, medium (which decides the crops that
// fit), the categories the farm keeps it for, its area, and its positions with
// the places each holds. One save, one call; nothing is written before it.
function editZone(z) {
  const d = drawer('Edit ' + z.name, z.code + (z.cycle ? ' · irrigation cycle ' + z.cycle : ''));

  const name = input({ id: 'z-name', value: z.name });
  const type = selectBox(TYPES, z.type); type.id = 'z-type';
  const status = selectBox(STATUS, z.status || 'active'); status.id = 'z-status';
  const area = input({ id: 'z-area', type: 'number', min: 0, step: '0.1',
                       value: z.area_m2 == null ? '' : Number(z.area_m2) });
  const media = toggles(MEDIA, z.media);
  const cats = toggles(CATS, z.crop_categories);

  const g1 = el('div', 'grid3');
  g1.append(field('Name', name), field('System', type), field('Status', status));
  d.body.append(g1);
  d.body.append(field('Growing medium', media,
    'Decides which crops fit: a crop grows here when its medium is one of these.'));
  d.body.append(field('Kept for (optional)', cats,
    'Leave empty unless the farm has chosen to keep this zone for some crops only.'));
  d.body.append(field('Area (m²)', area));

  // the positions, edited in place and sent together on save
  const rows = (z.position_list || []).map(p => ({ ...p, orig: { ...p } }));
  const posBox = el('div');
  const sum = el('span', 'hint');
  const paintSum = () => {
    const live = rows.filter(r => !r.remove);
    sum.textContent = `${live.length} positions · `
      + `${live.reduce((a, r) => a + Number(r.capacity || 0), 0).toLocaleString()} places`;
  };
  const paintPositions = () => {
    posBox.textContent = '';
    rows.forEach(r => {
      const line = el('div', 'row');
      line.style.margin = '0 0 var(--space-2)';
      if (r.remove) line.style.opacity = '0.45';
      const code = input({ value: r.code || '', placeholder: 'code (automatic)' });
      code.style.flex = '2';
      code.disabled = !!r.remove;
      code.oninput = () => { r.code = code.value.trim(); };
      const cap = input({ type: 'number', min: 1, step: '1',
                          value: r.capacity == null ? '' : Number(r.capacity) });
      cap.style.flex = '1';
      cap.title = 'Places (plants) in this position';
      cap.disabled = !!r.remove;
      cap.oninput = () => { r.capacity = cap.value; paintSum(); };
      const x = el('button', 'btn btn-sm', r.remove ? 'Keep' : 'Remove');
      if (r.used && !r.remove) {
        x.disabled = true;
        x.title = 'Batches or tasks were planned here, so it keeps its history.';
      }
      x.onclick = () => {
        if (!r.id) rows.splice(rows.indexOf(r), 1); else r.remove = !r.remove;
        paintPositions();
      };
      line.append(code, cap, el('span', 'hint', 'places'), x);
      posBox.append(line);
    });
    paintSum();
  };

  const posHead = el('div', 'row');
  posHead.style.margin = 'var(--space-4) 0 var(--space-2)';
  posHead.style.flexWrap = 'wrap';
  posHead.append(el('b', null, 'Positions'), sum, el('div', 'spacer'));
  const every = input({ type: 'number', min: 1, step: '1', placeholder: 'places' });
  every.style.width = '90px';
  const setAll = el('button', 'btn btn-sm', 'Set all');
  setAll.title = 'Give every position the same number of places';
  setAll.onclick = () => {
    const n = Number(every.value);
    if (!(n > 0)) { toast('Type a number of places first', 'bad'); return; }
    rows.forEach(r => { if (!r.remove) r.capacity = n; });
    paintPositions();
  };
  const add = el('button', 'btn btn-sm', '+ Add position');
  add.onclick = () => {
    const last = rows.filter(r => !r.remove).slice(-1)[0];
    rows.push({ code: '', capacity: last ? last.capacity : 1, used: false });
    paintPositions();
  };
  posHead.append(every, setAll, add);
  d.body.append(posHead, posBox);
  d.body.append(el('div', 'hint',
    'A position is the unit you plan in: a whole NFT table, an NGS row, a bench. ' +
    'One that ever had a batch or a task keeps its history and cannot be removed.'));
  paintPositions();

  const cancel = el('button', 'btn', 'Cancel');
  cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Save the zone');
  save.onclick = async () => {
    const m = media.value();
    if (!m.length) { toast('Pick at least one growing medium', 'bad'); return; }
    if (!name.value.trim()) { toast('A zone needs a name', 'bad'); return; }
    if (rows.some(r => !r.remove && !(Number(r.capacity) > 0))) {
      toast('Every position needs at least 1 place', 'bad'); return;
    }
    const positions = [];
    rows.forEach(r => {
      if (!r.id) positions.push({ code: r.code || null, capacity: Number(r.capacity) });
      else if (r.remove) positions.push({ id: r.id, remove: true });
      else if (r.code !== r.orig.code || Number(r.capacity) !== Number(r.orig.capacity))
        positions.push({ id: r.id, code: r.code || r.orig.code, capacity: Number(r.capacity) });
    });
    busy(save, true, 'Saving…');
    try {
      const r = await rpc('save_growing_system', { p_system: z.id, p: {
        name: name.value.trim(), system_type: type.value, status: status.value,
        media: m, crop_categories: cats.value(),
        area_m2: area.value === '' ? null : Number(area.value),
        positions } });
      toast(`${name.value.trim()} saved · ${r.positions} positions · `
        + `${Number(r.places).toLocaleString()} places`, 'ok');
      d.close();
      await load();
    } catch (e) { busy(save, false, 'Save the zone'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
