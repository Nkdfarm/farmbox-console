// ═══════════════════════════════════════════════════════════════════════════
// Grow › Harvest — what was cut, what is coming, what the batches taught
// (console 0.7.71, migration 0072). The weight itself is typed in the harvest
// task on the phone; this page reads the harvests as harvests: the period's
// kg by crop against the planner's expectation, week by week, every cut, the
// batches still standing with their expected date and kg, and the yields
// learned so far beside the library figure (§10.7). A cut nobody typed on
// the phone can still be recorded here.
// ═══════════════════════════════════════════════════════════════════════════
import { rpc, openFast } from './api.js';
import { loading, el, table, pageHead, drawer, field, input, selectBox, toast, busy, num, shortDate, pref, ymd, parseYmd, addDays,
         mondayOf, subFamilyTag } from './ui.js';

const PERIOD_KEY = 'fbc_harvest_period';
const PERIODS = [['week', 'This week'], ['month', 'This month'], ['quarter', '3 months'], ['year', 'This year']];

let farm = null, data = null, mount = null;
let period = PERIODS.some(p => p[0] === pref.get(PERIOD_KEY)) ? pref.get(PERIOD_KEY) : 'month';

// the same arguments the page uses, for warm()
export function harvestRange(p = period) {
  const t = new Date();
  if (p === 'week') { const m = mondayOf(t); return { p_from: ymd(m), p_to: ymd(addDays(m, 6)) }; }
  if (p === 'quarter') return { p_from: ymd(addDays(t, -90)), p_to: ymd(t) };
  if (p === 'year') return { p_from: `${t.getFullYear()}-01-01`, p_to: `${t.getFullYear()}-12-31` };
  const first = new Date(t.getFullYear(), t.getMonth(), 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  return { p_from: ymd(first), p_to: ymd(last) };
}

export async function renderHarvest(container, currentFarm) {
  farm = currentFarm; mount = container;
  await load();
}

// last time's copy at once, the server's answer behind it (openFast, 0.7.108)
async function load() {
  const here = mount;
  await openFast([['harvest_overview', { p_farm: farm.id, ...harvestRange() }]], {
    show: ([d]) => { data = d; paint(); },
    waiting: () => { mount.textContent = ''; mount.append(loading('Reading the harvests…')); },
    failed: e => { mount.textContent = ''; mount.append(el('div', 'note bad', e.message)); },
    stillHere: () => here.isConnected && mount === here,
  });
}

const kg = v => v == null ? '—' : `${num(v, Number(v) < 10 ? 2 : 1)} kg`;

function paint() {
  mount.textContent = '';
  const t = data.totals || {};

  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Period');
  PERIODS.forEach(([v, label]) => {
    const b = el('button', 'seg-btn', label);
    b.setAttribute('aria-pressed', String(v === period));
    b.onclick = () => { period = v; pref.set(PERIOD_KEY, v); load(); };
    seg.append(b);
  });
  const rec = data.may_record ? el('button', 'btn btn-primary', 'Record a cut') : null;
  if (rec) rec.onclick = () => recordCut(null);
  mount.append(pageHead('Harvest',
    `${shortDate(data.from)} – ${shortDate(data.to)}. The weight is typed on the phone in the harvest task; ` +
    'this is what came in, what is still standing, and what the finished batches taught the planner.', seg, rec));

  // ── the numbers ──
  const tiles = el('div', 'tiles');
  const tile = (v, label, sub) => {
    const x = el('div', 'tile'); const body = el('div', 'tile-body');
    body.append(el('div', 'tile-value', v), el('div', 'tile-label', label));
    if (sub) body.append(el('div', 'hint', sub));
    x.append(body); tiles.append(x);
  };
  tile(kg(t.kg), 'harvested', t.expected_kg ? `${kg(t.expected_kg)} expected in the period` : null);
  tile(String(t.cuts ?? 0), `cut${t.cuts === 1 ? '' : 's'}`, t.batches ? `from ${t.batches} batch${t.batches === 1 ? '' : 'es'}` : null);
  tile(String(t.finished ?? 0), 'batches finished');
  tile(kg(t.waste_kg), 'waste', t.kg && t.waste_kg ? `${Math.round(100 * t.waste_kg / (Number(t.kg) + Number(t.waste_kg)))} % of what was cut` : null);
  mount.append(tiles);

  // ── by crop ──
  const crops = data.by_crop || [];
  if (crops.length) {
    const max = Math.max(...crops.map(c => Number(c.kg) || 0), 1);
    mount.append(cardWith('By crop', 'harvested against what the planner expected in the period', table([
      { key: 'crop', label: 'Crop', fmt: (v, r) => { const b = el('div'); b.append(el('b', null, v)); if (r.category) b.append(subFamilyTag(r.category, 'tag')); return b; } },
      { key: 'kg', label: 'Harvested', align: 'right', fmt: v => {
          const w = el('div', 'ipm-bar-wrap'); const bar = el('div', 'ipm-bar');
          bar.style.width = Math.max(2, Math.round(110 * (Number(v) || 0) / max)) + 'px';
          w.append(bar, el('span', null, kg(v))); return w; } },
      { key: 'expected_kg', label: 'Expected', align: 'right', fmt: (v, r) => v ? kg(v) + (Number(r.kg) ? ` · ${Math.round(100 * r.kg / v)} %` : '') : '—' },
      { key: 'cuts', label: 'Cuts', align: 'right', fmt: (v, r) => `${v} · ${r.batches} batch${r.batches === 1 ? '' : 'es'}` },
      { key: 'waste_kg', label: 'Waste', align: 'right', fmt: v => Number(v) ? kg(v) : '—' },
    ], crops)));
  }

  // ── week by week ──
  if ((data.weeks || []).length > 1) {
    mount.append(cardWith('Week by week', null, table([
      { key: 'week', label: 'Week of', fmt: shortDate },
      { key: 'kg', label: 'Harvested', align: 'right', fmt: kg },
      { key: 'cuts', label: 'Cuts', align: 'right' },
      { key: 'waste_kg', label: 'Waste', align: 'right', fmt: v => Number(v) ? kg(v) : '—' },
    ], data.weeks.slice().reverse())));
  }

  // ── standing ──
  const standing = data.standing || [];
  mount.append(cardWith('Still standing', `${standing.length} batch${standing.length === 1 ? '' : 'es'} planted — soonest harvest first`, table([
    { key: 'crop', label: 'Crop', fmt: (v, r) => { const b = el('div'); b.append(el('b', null, v)); b.append(el('div', 'hint', `${r.batch || ''}${r.position ? ' · ' + r.position : ''}${r.system ? ' · ' + r.system : ''}`)); return b; } },
    { key: 'harvest_start', label: 'Harvest', fmt: (v, r) => {
        const d = Number(r.due_in_days);
        const s = el('span', 'pill' + (d < 0 ? ' warn' : d <= 7 ? ' ok' : ''), d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`);
        s.title = `${shortDate(v)}${r.harvest_end ? ' – ' + shortDate(r.harvest_end) : ''}`;
        return s; } },
    { key: 'expected_kg', label: 'Expected', align: 'right', fmt: v => v ? kg(v) : '—' },
    { key: 'cut_so_far', label: 'Cut so far', align: 'right', fmt: (v, r) => Number(v) ? `${kg(v)} · ${r.cuts} cut${r.cuts === 1 ? '' : 's'}` : '—' },
    { key: 'status', label: 'Status', fmt: v => el('span', 'pill' + (v === 'active' ? ' ok' : ''), v === 'active' ? 'growing' : v) },
    { key: 'id', label: '', fmt: (v, r) => { if (!data.may_record) return ''; const b = el('button', 'btn btn-sm btn-ghost', 'Record a cut'); b.onclick = e => { e.stopPropagation(); recordCut(r); }; return b; } },
  ], standing, { empty: 'Nothing planted right now — Crop planner puts batches on the positions.' })));

  // ── the cuts ──
  const cuts = data.cuts || [];
  mount.append(cardWith('The cuts', `${cuts.length} in the period, newest first`, table([
    { key: 'date', label: 'Day', fmt: shortDate },
    { key: 'crop', label: 'Crop', fmt: (v, r) => { const b = el('div'); b.append(el('b', null, v)); b.append(el('div', 'hint', `${r.batch || ''}${r.position ? ' · ' + r.position : ''}`)); return b; } },
    { key: 'kg', label: 'Weight', align: 'right', fmt: (v, r) => `${num(v, 2)} ${r.unit || 'kg'}` },
    { key: 'cut', label: 'Cut', align: 'right', fmt: (v, r) => `${v}${r.final ? ' · last' : ''}` },
    { key: 'waste_kg', label: 'Waste', align: 'right', fmt: (v, r) => Number(v) ? kg(v) + (r.waste_reason ? ` · ${r.waste_reason}` : '') : '—' },
    { key: 'who', label: 'Who', fmt: (v, r) => [v, r.task].filter(Boolean).join(' · ') || '—' },
  ], cuts, { empty: 'No cut recorded in this period.' })));

  // ── yields learned ──
  const yields = data.yields || [];
  if (yields.length) {
    mount.append(cardWith('Yields learned', 'from finished batches — what the planner now uses (§10.7), beside the figure it started from', table([
      { key: 'crop', label: 'Crop', fmt: (v, r) => `${v} · ${r.system_type}` },
      { key: 'batches', label: 'Finished', align: 'right' },
      { key: 'kg_per_batch', label: 'Per batch', align: 'right', fmt: v => kg(v) },
      { key: 'kg_per_plant', label: 'Per plant', align: 'right', fmt: v => v != null ? `${num(v, 3)} kg` : '—' },
      { key: 'yield_per_position', label: 'Planner uses', align: 'right', fmt: (v, r) => v != null ? `${num(v, 2)} ${r.unit || ''}/position${r.yield_manual != null ? ' · typed' : ''}` : '—' },
    ], yields)));
  }
}

function cardWith(title, hint, body) {
  const c = el('div', 'card');
  c.style.marginBottom = 'var(--space-4)';
  const head = el('div', 'row'); head.style.padding = 'var(--space-3) var(--space-4)';
  head.append(el('b', null, title));
  if (hint) head.append(el('span', 'hint', ' · ' + hint));
  c.append(head, body);
  return c;
}

// a cut typed here rather than on the phone
function recordCut(batch) {
  const standing = data.standing || [];
  if (!standing.length) { toast('Nothing is standing to be cut', 'bad'); return; }
  const d = drawer('Record a cut', 'For a weight nobody typed on the phone. The batch goes active on its first cut; the last cut frees the position.');
  const pick = selectBox(standing.map(s => [s.id, `${s.crop} · ${s.position || s.batch}${s.cut_so_far ? ` (${kg(s.cut_so_far)} so far)` : ''}`]), batch?.id || standing[0].id);
  const qty = input({ type: 'number', min: 0, step: '0.1', placeholder: 'kg' });
  const waste = input({ type: 'number', min: 0, step: '0.1', placeholder: 'kg' });
  const date = input({ type: 'date', value: data.today });
  const final = selectBox([['false', 'More to come'], ['true', 'Last cut — the position is cleared']], 'false');
  const g = el('div', 'grid2'); g.append(field('Weight', qty), field('Waste', waste));
  const g2 = el('div', 'grid2'); g2.append(field('Day', date), field('Then', final));
  d.body.append(field('Batch', pick), g, g2);
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const save = el('button', 'btn btn-primary', 'Record');
  save.onclick = async () => {
    const v = parseFloat(qty.value);
    if (!(v > 0)) { toast('A cut needs a weight', 'bad'); return; }
    busy(save, true, 'Recording…');
    try {
      await rpc('record_harvest', { p: { crop_plan_id: pick.value, qty: v, unit: 'kg', final: final.value === 'true',
                                         waste_qty: parseFloat(waste.value) || null, date: date.value || null } });
      d.close(); toast(`${kg(v)} recorded`, 'ok'); await load();
    } catch (e) { busy(save, false, 'Record'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, save);
}
