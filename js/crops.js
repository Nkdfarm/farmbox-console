// ═══════════════════════════════════════════════════════════════════════════
// Crops & plan — the 2D map, and what goes in each position next (spec §7.2, §10.4)
//
// A simplified drawing rather than a rendering: one tile per growing position,
// grouped by zone, coloured by what is in it. Tap a tile to see the batch and
// to plan the next one. The planner proposes; a person validates; only then
// does any task exist.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, field, input, selectBox, toast, drawer, confirmDrawer, busy, systemLabel, mediumLabel, nurseryField, nurseryLine } from './ui.js';

const CAT = { leafy:'ag', mixed_leafy:'ag', herbs:'ag', fruiting_vines:'mt', fruiting_bush:'mt', microgreens:'of' };
let farm = null, map = null, mount = null;

const fmt = d => d ? new Date(d + 'T00:00:00')
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
const money = (n, cur) => n == null ? '—'
  : `${cur} ${Math.round(Number(n)).toLocaleString()}`;
const daysTo = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000) : null;

export async function renderCrops(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  await openFast([['crop_map', { p_farm: farm.id }]], {
    show: ([d]) => { map = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Drawing the farm…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

const allBatches = () => (map.systems || [])
  .flatMap(s => (s.positions || []).flatMap(p => (p.batches || []).map(b => ({ ...b, pos: p, sys: s }))));

function paint() {
  mount.textContent = '';
  const may = map.may_plan;
  const cur = map.currency || 'ZAR';

  const head = el('div', 'page-head');
  const titles = el('div');
  titles.append(el('p', null,
    'One tile per growing position. The planner fills the empty ones with whatever ' +
    'earns most per day the position is tied up, priced at the season it will be ' +
    'harvested in. Nothing is planted until you validate it.'));
  head.append(titles, el('div', 'spacer'));
  if (may) {
    const b = el('button', 'btn btn-primary', 'Plan the whole farm');
    b.onclick = () => propose(b);
    head.append(b);
  }
  mount.append(head);

  mount.append(summary(cur));

  const proposed = allBatches().filter(b => b.status === 'proposed');
  if (proposed.length) mount.append(proposalCard(proposed, cur, may));

  (map.systems || []).forEach(s => mount.append(zoneCard(s, cur)));
}

function summary(cur) {
  const row = el('div', 'row');
  row.style.margin = '0 0 var(--space-4)';
  const pill = (t, k) => row.append(el('span', 'pill ' + (k || ''), t));

  const pos = (map.systems || []).flatMap(s => s.positions || []);
  const b = allBatches();
  const growing = b.filter(x => x.status === 'active' || x.status === 'validated');
  const prop = b.filter(x => x.status === 'proposed');
  const empty = pos.filter(p => !(p.batches || []).length);

  pill(`${pos.length} positions`);
  pill(`${growing.length} growing`, growing.length ? 'ok' : '');
  pill(`${empty.length} empty`, empty.length ? 'warn' : 'ok');
  if (prop.length) {
    const rev = prop.reduce((a, x) => a + Number(x.revenue || 0), 0);
    pill(`${prop.length} proposed · ${money(rev, cur)}`, '');
  }
  return row;
}

// ── the proposal, before anyone commits to it ──────────────────────────────
function proposalCard(proposed, cur, may) {
  const card = el('div', 'card card-pad');
  card.style.marginBottom = 'var(--space-4)';
  card.style.borderLeft = '4px solid var(--accent)';

  const byCrop = new Map();
  proposed.forEach(b => {
    const k = b.crop;
    if (!byCrop.has(k)) byCrop.set(k, { crop: k, n: 0, rev: 0, yield: 0, tp: b.transplant_date, hs: b.harvest_start });
    const g = byCrop.get(k);
    g.n++; g.rev += Number(b.revenue || 0); g.yield += Number(b.yield || 0);
    if (b.transplant_date < g.tp) g.tp = b.transplant_date;
    if (b.harvest_start < g.hs) g.hs = b.harvest_start;
  });

  const h = el('div', 'row');
  h.append(el('b', null, `${proposed.length} positions proposed`));
  h.append(el('span', 'spacer', ''));
  h.append(el('span', 'pill ok',
    money(proposed.reduce((a, x) => a + Number(x.revenue || 0), 0), cur) + ' expected'));
  card.append(h);
  card.append(el('div', 'hint',
    'Priced at the season each batch will be harvested in. Validating creates the ' +
    'sowing, transplant, harvest and cleaning tasks — nothing before that.'));

  const wrap = el('div', 'table-wrap');
  wrap.style.marginTop = 'var(--space-3)';
  const t = el('table', 'people');
  const th = el('thead'), hr = el('tr');
  ['Crop','Positions','Transplant','First harvest','Yield','Revenue'].forEach(x => hr.append(el('th', null, x)));
  th.append(hr); t.append(th);
  const tb = el('tbody');
  [...byCrop.values()].sort((a,b) => b.rev - a.rev).forEach(g => {
    const tr = el('tr');
    const c = x => { const d = el('td'); d.append(x); return d; };
    tr.append(c(el('b', null, g.crop)));
    tr.append(c(el('span', 'mono', String(g.n))));
    tr.append(c(el('span', null, fmt(g.tp))));
    tr.append(c(el('span', null, fmt(g.hs))));
    tr.append(c(el('span', 'mono', Math.round(g.yield).toLocaleString() + ' kg')));
    tr.append(c(el('span', 'mono', money(g.rev, cur))));
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); card.append(wrap);

  if (may) {
    const row = el('div', 'row');
    row.style.marginTop = 'var(--space-4)';
    const drop = el('button', 'btn btn-danger', 'Discard the proposal');
    drop.onclick = async () => {
      if (!await confirmDrawer('Discard it?',
        `${proposed.length} proposed batches will be removed. Nothing that is already `
        + `growing or validated is touched.`, 'Discard', true)) return;
      try {
        await rpc('cancel_crop_plan', { p_ids: proposed.map(b => b.id) });
        toast('Proposal discarded', 'ok'); await load();
      } catch (e) { toast(e.message, 'bad'); }
    };
    const ok = el('button', 'btn btn-primary', 'Validate all ' + proposed.length);
    ok.onclick = async () => {
      busy(ok, true, 'Validating…');
      try {
        const r = await rpc('validate_crop_plan', { p_ids: proposed.map(b => b.id) });
        toast(`${r.validated} batches, ${r.tasks_created} tasks created`, 'ok');
        await load();
      } catch (e) { busy(ok, false, 'Validate'); toast(e.message, 'bad'); }
    };
    row.append(drop, el('div', 'spacer', ''), ok);
    card.append(row);
  }
  return card;
}

// ── one zone, drawn ────────────────────────────────────────────────────────
function zoneCard(s, cur) {
  const card = el('div', 'card');
  card.style.marginBottom = 'var(--space-3)';

  const head = el('div', 'row');
  head.style.padding = 'var(--space-3) var(--space-4)';
  head.style.borderBottom = '1px solid var(--border)';
  // The zone's name, then the system chosen for it on Farm setup (NFT, NGS, …)
  // in the same size, lighter. The medium is a tooltip on the system.
  head.append(el('b', null, s.name));
  const sys = el('span', 'zone-sys', systemLabel(s.type));
  const media = (s.media || []).map(m => mediumLabel(m)).join(', ');
  if (media) sys.title = 'Growing medium: ' + media;
  sys.style.color = 'var(--text-muted, #9a9aa3)';
  sys.style.fontWeight = '500';
  head.append(sys);
  if ((s.categories || []).length) {
    const c = el('span', 'pill warn', 'kept for ' + s.categories.join(', ').replace(/_/g, ' '));
    c.title = 'A choice this farm has made, not a limit of the system.';
    head.append(c);
  }
  const plants = (s.positions || []).reduce((a, p) => a + Number(p.capacity || 0), 0);
  head.append(el('span', 'pill', `${(s.positions||[]).length} positions · ${plants.toLocaleString()} places`));
  const free = (s.positions || []).filter(p => !(p.batches || []).length).length;
  if (free) head.append(el('span', 'pill warn', `${free} empty`));
  if (map.may_plan) {
    head.append(el('div', 'spacer', ''));
    const b = el('button', 'btn btn-sm', 'Plan this bay');
    b.title = 'Only this bay. Every other bay keeps the proposal it has.';
    b.onclick = () => propose(b, s.code, s.name);
    head.append(b);
  }
  card.append(head);

  const grid = el('div', 'plot');
  (s.positions || []).forEach(p => grid.append(tile(p, s, cur)));
  card.append(grid);
  return card;
}

function tile(p, s, cur) {
  const b = (p.batches || [])[0];
  const t = el('button', 'plot-tile');
  if (b) t.classList.add('fam-' + (CAT[b.category] || 'ag'), 'is-' + b.status);
  else t.classList.add('is-empty');

  t.append(el('span', 'plot-code', p.code.replace(/^FL-/, '')));
  if (b) {
    // the full name, truncated by CSS — "English" alone does not say cucumber
    const name = el('span', 'plot-crop', b.crop);
    name.title = b.crop;
    t.append(name);
    const d = daysTo(b.harvest_start), e = daysTo(b.harvest_end);
    const over = b.status === 'active' && e != null && e < 0;
    if (over) t.classList.add('is-over');
    const when = el('span', 'plot-when',
      b.status === 'proposed' ? 'from ' + fmt(b.transplant_date)
      : d == null ? 'no dates'
      : d > 0 ? d + ' d to harvest'
      // past its harvest end and still standing: the last cut was never recorded (0.7.112)
      : over ? 'harvest ended ' + fmt(b.harvest_end)
      : 'harvesting');
    if (over) when.title = 'Still in the position: record the last cut (Grow › Harvest) to free it.';
    t.append(when);
  } else {
    t.append(el('span', 'plot-crop', 'Empty'));
    t.append(el('span', 'plot-when', 'free ' + fmt(p.free_on)));
  }
  t.onclick = () => openPosition(p, s, cur);
  return t;
}

// ── one position, and what to do with it ───────────────────────────────────
function openPosition(p, s, cur) {
  const d = drawer(p.code, `${s.name} · ${Number(p.capacity).toLocaleString()} places`
    + (p.area_m2 ? ` · ${Number(p.area_m2)} m²` : ''));

  const facts = el('div', 'set-group');
  const row = (k, v) => { if (v == null || v === '') return;
    const r = el('div', 'set-row'); r.append(el('span', null, k));
    r.append(el('span', null, String(v))); facts.append(r); };

  (p.batches || []).forEach(b => {
    facts.append(el('div', 'set-row'));
    row('Crop', b.crop);
    row('Batch', b.batch_code);
    row('State', b.status + (b.mode === 'auto' ? ' · proposed by the planner' : ''));
    if (b.nursery !== 'external') row('Sow', fmt(b.sow_date));
    row('Seedlings', nurseryLine(b));
    row('Transplant', fmt(b.transplant_date));
    // internal or external, until the seedlings are ordered (0101)
    if (map.may_plan && b.id && b.nursery && !b.nursery_plan?.ordered_at && b.status !== 'active') {
      const other = b.nursery === 'external' ? 'internal' : 'external';
      const sw = el('button', 'btn btn-sm', other === 'external' ? 'Order from a nursery instead' : 'Sow it ourselves instead');
      sw.onclick = async () => {
        busy(sw, true, 'Changing…');
        try {
          const r = await rpc('set_batch_nursery', { p_plan: b.id, p_nursery: other });
          d.close();
          toast(other === 'external'
            ? (r.order_by ? `Seedlings to order by ${fmt(r.order_by)}${r.late ? ' — late' : ''} · delivery ${fmt(r.delivery)}` : 'External nursery')
            : 'Sown in our nursery', r.late ? 'bad' : 'ok');
          await load();
        } catch (e) { busy(sw, false, sw.textContent); toast(e.message, 'bad'); }
      };
      const r = el('div', 'set-row'); r.append(el('span'), sw); facts.append(r);
    }
    row('Harvest', fmt(b.harvest_start) + (b.harvest_end ? ' → ' + fmt(b.harvest_end) : ''));
    if (b.yield) row('Expected', Math.round(b.yield) + ' kg · ' + money(b.revenue, cur));
    // a batch standing here without dates never makes a task: a manager dates it (0076)
    if (map.may_plan && b.id && ['validated', 'active'].includes(b.status) && !b.transplant_date) {
      const when = input({ type: 'date' });
      const go = el('button', 'btn btn-sm', 'Set dates');
      go.onclick = async () => {
        if (!when.value) { toast('Pick the transplant date', 'bad'); return; }
        busy(go, true, 'Saving…');
        try {
          const r = await rpc('set_batch_dates', { p_plan: b.id, p_transplant: when.value });
          d.close(); toast(`Dated · harvest from ${fmt(r.harvest_start)} · ${r.tasks} tasks`, 'ok'); await load();
        } catch (e) { busy(go, false, 'Set dates'); toast(e.message, 'bad'); }
      };
      const r = el('div', 'set-row'); r.append(el('span', null, 'Transplanted on'));
      const w = el('span'); w.append(when, go); r.append(w); facts.append(r);
      facts.append(el('div', 'hint', 'No dates on this batch, so it has no tasks. The harvest window follows from the cycle.'));
    }
  });
  if (!(p.batches || []).length) row('Free from', fmt(p.free_on));
  row('Grows in', (s.media || []).map(m => mediumLabel(m)).join(', '));
  d.body.append(facts);

  if (map.may_plan) {
    d.body.append(el('div', 'sec-title', 'Plan the next batch'));
    // the medium decides, and so does the zone's own policy where it has one
    const fits = (map.crops || []).filter(c =>
      (c.media || []).some(m => (s.media || []).includes(m))
      && (!(s.categories || []).length || s.categories.includes(c.category)));
    if (!fits.length) {
      d.body.append(el('div', 'note warn',
        `Nothing approved grows in ${(s.media || []).map(m => mediumLabel(m)).join(' or ')}`
        + ((s.categories || []).length
            ? ` within ${s.categories.join(', ').replace(/_/g, ' ')}, which is what this zone is kept for.`
            : '.')
        + ' Give a crop that medium on the crop page, or widen the zone.'));
    } else {
      const crop = selectBox(fits.map(c => [c.id, c.name]));
      const when = input({ type: 'date', value: p.free_on });
      const nurs = nurseryField(fits[0]);
      crop.onchange = () => nurs.set(fits.find(c => c.id === crop.value));
      d.body.append(field('Crop', crop), field('Transplant on', when,
        'Defaults to the day this position is free. The sowing date follows from the cycle.'), nurs.field);
      const go = el('button', 'btn btn-primary', 'Propose it');
      go.onclick = async () => {
        busy(go, true, 'Planning…');
        try {
          const r = await rpc('plan_position', { p_position: p.id, p_crop: crop.value,
                                                 p_transplant: when.value || null });
          if (nurs.value() && r?.id && r.nursery !== nurs.value())
            await rpc('set_batch_nursery', { p_plan: r.id, p_nursery: nurs.value() });
          d.close(); toast('Proposed', 'ok'); await load();
        } catch (e) { busy(go, false, 'Propose it'); toast(e.message, 'bad'); }
      };
      d.body.append(go);
    }

    const cancellable = (p.batches || []).filter(b => b.status !== 'active');
    if (cancellable.length) {
      const rm = el('button', 'btn btn-danger');
      rm.textContent = 'Remove ' + (cancellable.length > 1 ? 'these batches' : 'this batch');
      rm.onclick = async () => {
        d.close();
        try {
          await rpc('cancel_crop_plan', { p_ids: cancellable.map(b => b.id) });
          toast('Removed', 'ok'); await load();
        } catch (e) { toast(e.message, 'bad'); }
      };
      d.footer.append(rm);
    }
  }

  const close = el('button', 'btn', 'Close');
  close.onclick = d.close;
  d.footer.append(el('div', 'spacer', ''), close);
}

// scope is a system code for one bay, or nothing for the whole farm
async function propose(button, scope, label) {
  const back = button.textContent;
  busy(button, true, 'Planning…');
  try {
    const r = await rpc('propose_crop_plan', {
      p_farm: farm.id, p_horizon_days: 60, p_system: scope ?? null });
    // "0 proposed" has two meanings and the manager needs to know which
    toast(r.proposed ? `${r.proposed} positions proposed in ${r.scope}`
          : r.nothing_fits ? `${r.nothing_fits} free, but no approved crop fits ${r.scope}`
          : `Nothing to plan — ${r.scope} is full past the horizon`,
          r.proposed ? 'ok' : r.nothing_fits ? 'bad' : '');
    await load();
  } catch (e) { busy(button, false, back); toast(e.message, 'bad'); }
}
