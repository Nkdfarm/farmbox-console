// succession planting: the same crop again and again, and the zone split menu
import { drawer, selectBox, input, el, field, systemLabel, busy, toast, confirmDrawer } from '../ui.js';
import { rpc } from '../api.js';
import { ds, dn, nice, S } from './state.js';
import { fits, cycleOf, reload } from './index.js';

// ── succession: the same crop again and again ────────────────────────────────
export function succession() {
  const crops = S.data.crops || [];
  const d = drawer('Plant in succession', 'The same crop at a steady rhythm, for a harvest every week rather than all at once');
  const crop = selectBox(crops.map(c => [c.id, c.name]));
  const zone = selectBox([]);
  const first = input({ type: 'date' });
  const every = input({ type: 'number', min: 1, value: 1 });
  const unit = selectBox([['7', 'week(s)'], ['1', 'day(s)']], '7');
  const times = input({ type: 'number', min: 1, max: 52, value: 8 });
  const each = input({ type: 'number', min: 1, value: 1 });
  const info = el('div', 'hint');
  const cropOf = () => crops.find(c => c.id === crop.value);
  const fillZones = () => {
    const c = cropOf();
    zone.textContent = '';
    const any = el('option', null, 'Any zone it grows in'); any.value = ''; zone.append(any);
    (S.data.systems || []).filter(sy => fits(c, sy)).forEach(sy => { const o = el('option', null, `${sy.name} · ${systemLabel(sy.type)}`); o.value = sy.code; zone.append(o); });
    first.value = ds(dn(S.data.today) + (c.lead || 0));
    say();
  };
  const say = () => {
    const c = cropOf(); if (!c || !first.value) return;
    const step = Number(every.value || 1) * Number(unit.value), n = Number(times.value || 1), k = Number(each.value || 1);
    const a = cycleOf(c, dn(first.value)), z = cycleOf(c, dn(first.value) + step * (n - 1));
    const zones = (S.data.systems || []).filter(sy => fits(c, sy) && (!zone.value || sy.code === zone.value));
    const room = zones.reduce((t, sy) => t + (sy.positions || []).length, 0);
    info.textContent = `${n} plantings × ${k} position${k > 1 ? 's' : ''} = ${n * k} batches · harvest from ${nice(ds(a.hs))} to ${nice(ds(z.he))}` +
      ` · each stays ${a.to - a.tp + 1} days, so about ${Math.ceil((a.to - a.tp + 1) / step) * k} positions are busy at once (${room} in ${zone.value ? 'this zone' : 'the zones it grows in'})` +
      (a.sow < dn(S.data.today) ? ' · the first planting is too soon for its seedlings' : '');
  };
  crop.onchange = fillZones; [zone, every, unit, times, each].forEach(x => x.onchange = say); first.onchange = say;
  [every, times, each].forEach(x => x.oninput = say);
  const ev = el('div', 'row'); ev.append(every, unit);
  d.body.append(field('Crop', crop), field('Zone', zone), field('First transplant', first),
    field('Every', ev), field('How many plantings', times), field('Positions each time', each), info,
    el('div', 'hint', 'Only free slots are used — each planting takes positions that are free for its whole stay. Everything lands as a proposal to validate.'));
  fillZones();
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Propose the series');
  go.onclick = async () => {
    busy(go, true, 'Planning…');
    try {
      const r = await rpc('plan_succession', { p_farm: S.farm.id, p_crop: crop.value, p_first: first.value,
        p_every_days: Number(every.value) * Number(unit.value), p_times: Number(times.value), p_positions_each: Number(each.value),
        p_system: zone.value || null });
      d.close();
      const short = r.short || [];
      toast(`${r.crop}: ${r.placed} of ${r.wanted} batches proposed · ${Math.round(r.expected_kg).toLocaleString()} kg · harvest ${nice(r.harvest_from)} – ${nice(r.harvest_to)}` +
        (short.length ? ` · ${short.length} planting${short.length > 1 ? 's' : ''} short: ${short.slice(0, 3).map(x => `${nice(x.transplant)} ${x.reason}`).join('; ')}` : ''),
        short.length ? 'bad' : 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Propose the series'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, go);
}

// ── how many growing positions a zone has (0.7.116; half rows since 0.7.135) ──
// A position is a whole number of the HALF rows or tables built in the zone, so ten
// rows give 20, 10, 5, 4, 2 or 1 positions (the database lists them: sys.splits).
// On a steady zone the change is applied at once and the group planned again, with
// Undo in the steady bar; elsewhere it asks first.
export function rowsText(r) {
  const n = Number(r), whole = Math.floor(n + 1e-9), half = n - whole > 0.25;
  if (!half) return `${whole} row${whole === 1 ? '' : 's'}`;
  return `${whole || ''}½ row${n > 1 ? 's' : ''}`;
}
export function splitMenu(sys) {
  const total = Math.round((sys.positions || []).reduce((a, p) => a + Number(p.capacity || 0), 0));
  const cur = (sys.positions || []).length;
  const base = Number(sys.base_units) || cur;
  const wrap = el('label', 'tl-split');
  const sel = el('select', 'input');
  const opts = (sys.splits || []).map(o => ({ n: Number(o.n), each: Number(o.places_each), rows: Number(o.rows_each) }));
  if (!opts.some(o => o.n === cur) && cur) opts.push({ n: cur, each: total / cur, rows: base / cur });
  opts.sort((a, b) => b.n - a.n).forEach(o => {
    const opt = el('option', null, `${o.n} × ${Math.round(o.each).toLocaleString()} · ${rowsText(o.rows)}`);
    opt.value = String(o.n); sel.append(opt);
  });
  sel.value = String(cur);
  sel.disabled = !!sys.locked;
  sel.title = sys.locked
    ? `${sys.name} has batches validated, growing or ordered: its positions stay as they are until they are harvested or cancelled`
    : `Growing positions in ${sys.name}: ${base} rows or tables built, ${total.toLocaleString()} places — a position is a whole number of half rows`;
  sel.onchange = async () => {
    const n = Number(sel.value);
    if (n === cur) return;
    if (sys.steady_group_id) {
      try {
        const r = await rpc('steady_set_positions', { p_system: sys.id, p_n: n });
        toast(`${sys.name}: ${n} positions — its steady group is planned again (${r.batches} batches). Undo is in the group's bar.`, 'ok');
        await reload();
      } catch (e) { sel.value = String(cur); toast(e.message, 'bad'); }
      return;
    }
    const ok = await confirmDrawer(`${n} positions in ${sys.name}?`,
      `${n} positions of ${Math.round(total / n).toLocaleString()} places each (${rowsText(base / n)}), instead of ${cur}. The positions already there keep ` +
      `their history and are named again after their rows (a half row is a or b); the zone's proposals are removed.`, 'Split it');
    if (!ok) { sel.value = String(cur); return; }
    try {
      const r = await rpc('split_zone', { p_system: sys.id, p_n: n });
      toast(`${r.zone}: ${r.positions} positions of ${Math.round(Number(r.places_each)).toLocaleString()} places`, 'ok');
      await reload();
    } catch (e) { sel.value = String(cur); toast(e.message, 'bad'); }
  };
  wrap.append(el('span', 'hint', 'Positions'), sel);
  return wrap;
}
