// FarmNet › Irrigation: Valves and bays, and EC and pH per crop (AI build mode P6, migration 0288, owner 20 Nov 2026:
// "valves linked to bays and positions … EC and pH ranges per crop and stage").
//   Valves and bays     folded, one per fertigation centre: FarmNet's valves (valve/group/list, the same list the program
//                       editor uses), each with the zones (bays) and positions of the farm layout it waters. The farm
//                       admin and the farm manager change a valve's set with Edit… — the registry command
//                       save_valve_zones (family water, class A: on the Timeline, revertable; the AI may propose or build
//                       it too). The links are the platform's own: FarmNet is not written to.
//   EC and pH per crop  folded, once for the page: the crops of the farm's plan, each stage with the EC (mS/cm) and pH
//                       range in force and where it comes from — the farm's own, the crop library, or a starting value
//                       from an extension guide (crop_range, 0288). The farm admin and the farm manager set the farm's own
//                       range (save_crop_range), or put it back to the starting value. The assistant keeps the recipes and
//                       programs it proposes inside these ranges; it never changes them.
import { rpc } from '../api.js';
import { el, drawer, field, pref, toast, busy, loading } from '../ui.js';
import { runCommand, tagCmd } from '../registry.js';
import { treeOf } from './programs.js';
import { ask, bad } from './shell.js';

const FROM = { farm: 'the farm\'s own', library: 'the crop library', starting: 'starting value' };
const STAGE = { all: 'Every stage', germination: 'Germination', nursery: 'Nursery', transplant: 'Transplant', vegetative: 'Vegetative',
  flowering: 'Flowering', harvest_window: 'Harvest', cleanup: 'Cleanup' };
const span = r => (r ? `${Number(r.min).toFixed(1)}–${Number(r.max).toFixed(1)}` : '—');

// a folded section, open as it was left on this computer; its content is read the first time it opens
function folded(key, title, load) {
  const d = el('details', 'ir-runs ir-fold');
  const sum = el('summary', 'fc-head fc-subhead');
  const h = el('h4', 'fc-sub', title);
  sum.append(h);
  d.append(sum);
  const box = el('div', 'ir-fold-body');
  d.append(box);
  let loaded = false;
  const fill = async () => {
    loaded = true;
    box.replaceChildren(loading('Reading…'));
    try { await load(box, t => { h.textContent = t; }); } catch (e) { box.replaceChildren(bad(e?.message || String(e))); loaded = false; }
  };
  d.open = pref.get(key) === '1';
  d.ontoggle = () => { pref.set(key, d.open ? '1' : '0'); if (d.open && !loaded) fill(); };
  if (d.open) fill();
  return d;
}

// ═══ Valves and bays ═════════════════════════════════════════════════════════
const where = l => (l.position_code ? `${l.system_code} · ${l.position_code}` : `${l.system_code} (whole zone)`);

export function valvesSection(ctx, c) {
  const farm = ctx.farm;
  return folded('fbc_fn_irr_valves', 'Valves and bays', async (box, retitle) => {
    const [tree, vz] = await Promise.all([
      ask(farm, 'valve_groups', { id: c.id, group: 1 }).then(treeOf, () => null),
      rpc('valve_zones', { p_farm: farm.id }, { quiet: true }),
    ]);
    const links = (vz?.links || []).filter(l => Number(l.centre_id) === Number(c.id));
    const mayEdit = !!vz?.may_edit;
    const linkedValves = new Set(links.map(l => Number(l.valve_id)));
    retitle(`Valves and bays · ${linkedValves.size} linked`);
    const redraw = () => { box.replaceChildren(loading('Reading…')); valvesBody(); };
    const valvesBody = async () => {
      const fresh = await rpc('valve_zones', { p_farm: farm.id }, { quiet: true });
      draw(fresh);
    };
    const draw = data => {
      const ls = (data?.links || []).filter(l => Number(l.centre_id) === Number(c.id));
      retitle(`Valves and bays · ${new Set(ls.map(l => Number(l.valve_id))).size} linked`);
      box.replaceChildren(el('div', 'hint', 'Which zones (bays) and positions each FarmNet valve waters. The assistant reads it to know what grows on a program\'s valves'
        + (mayEdit ? '; Edit… changes a valve\'s set (kept on the platform, nothing is sent to FarmNet).' : '.')));
      if (!tree) box.append(bad('FarmNet did not list its valves just now: the links are shown without their names.'));
      const list = el('div', 'vz-list');
      const seen = new Set();
      (tree || []).forEach(src => src.valves.forEach(v => {
        if (seen.has(v.id)) return; seen.add(v.id);
        list.append(valveRow(ctx, c, v, src.name, ls.filter(l => Number(l.valve_id) === v.id), data, mayEdit, redraw));
      }));
      // links of valves FarmNet does not list now (renamed, removed, or FarmNet not reached)
      const gone = [...new Set(ls.map(l => Number(l.valve_id)))].filter(id => !seen.has(id));
      gone.forEach(id => {
        const mine = ls.filter(l => Number(l.valve_id) === id);
        list.append(valveRow(ctx, c, { id, name: mine[0]?.valve_name || `Valve ${id}` }, tree ? 'not on FarmNet now' : '', mine, data, mayEdit, redraw));
      });
      if (!list.children.length) list.append(el('div', 'hint', 'FarmNet lists no valve for this centre.'));
      box.append(list);
    };
    draw(vz);
  });
}

function valveRow(ctx, c, v, srcName, mine, data, mayEdit, redraw) {
  const row = el('div', 'vz-row');
  const name = el('div', 'vz-name');
  name.append(el('b', null, v.name), el('span', 'hint', `valve ${v.id}${srcName ? ' · ' + srcName : ''}`));
  const picks = el('div', 'vz-picks');
  mine.forEach(l => picks.append(el('span', 'pill', where(l))));
  if (!mine.length) picks.append(el('span', 'hint', 'not linked'));
  row.append(name, picks);
  if (mayEdit) {
    const b = tagCmd(el('button', 'btn btn-sm', 'Edit…'), 'save_valve_zones', v.id); b.type = 'button';
    b.onclick = () => editValve(ctx, c, v, mine, data.systems || [], redraw);
    row.append(b);
  }
  return row;
}

function editValve(ctx, c, v, mine, systems, redraw) {
  const d = drawer(`${v.name} waters…`, `${c.name} · valve ${v.id} · the zones and positions of the farm layout it waters`);
  const whole = new Set(mine.filter(l => !l.position_id).map(l => l.system_id));
  const pos = new Set(mine.filter(l => l.position_id).map(l => l.position_id));
  const boxes = [];
  if (!systems.length) d.body.append(el('div', 'hint', 'This FarmBox has no zone in Farm setup yet.'));
  systems.forEach(s => {
    const sec = el('div', 'vz-zone');
    const lab = el('label', 'vz-zone-head');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = whole.has(s.id);
    lab.append(cb, el('b', null, ` ${s.code}`), el('span', 'hint', ` ${s.name || ''}${s.zone && s.zone !== s.name ? ' · ' + s.zone : ''} — the whole zone`));
    sec.append(lab);
    boxes.push({ cb, system_id: s.id, position_id: null });
    const ps = s.positions || [];
    if (ps.length) {
      const det = el('details', 'vz-pos');
      const some = ps.filter(p => pos.has(p.id)).length;
      det.append(el('summary', 'hint', `or only some of its ${ps.length} positions${some ? ` · ${some} chosen` : ''}`));
      det.open = some > 0;
      const grid = el('div', 'vz-pos-grid');
      ps.forEach(p => {
        const l = el('label', 'vz-pick');
        const pc = el('input'); pc.type = 'checkbox'; pc.checked = pos.has(p.id);
        l.append(pc, document.createTextNode(' ' + p.code));
        grid.append(l);
        boxes.push({ cb: pc, system_id: s.id, position_id: p.id });
      });
      det.append(grid);
      sec.append(det);
    }
    d.body.append(sec);
  });
  const save = el('button', 'btn btn-primary', 'Save'); save.type = 'button';
  const cancel = el('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.onclick = d.close;
  d.footer.append(cancel, save);
  save.onclick = async () => {
    // a whole zone ticked covers its positions: they are not sent apart
    const wholeNow = new Set(boxes.filter(b => b.cb.checked && !b.position_id).map(b => b.system_id));
    const targets = boxes.filter(b => b.cb.checked && (!b.position_id || !wholeNow.has(b.system_id)))
      .map(b => (b.position_id ? { system_id: b.system_id, position_id: b.position_id } : { system_id: b.system_id }));
    busy(save, true, 'Saving…');
    try {
      await runCommand('save_valve_zones', { p_farm: ctx.farm.id, p_centre: Number(c.id), p_valve: Number(v.id), p_valve_name: String(v.name).slice(0, 120), p_targets: targets }, { ctx });
      toast(targets.length ? `${v.name}: ${targets.length} zone${targets.length === 1 ? '' : 's'} or position${targets.length === 1 ? '' : 's'}` : `${v.name}: unlinked`, 'ok');
      d.close();
      redraw();
    } catch (e) {
      busy(save, false);
      toast(e?.message || String(e), 'bad');
    }
  };
}

// ═══ EC and pH per crop ══════════════════════════════════════════════════════
export function rangesSection(ctx) {
  const farm = ctx.farm;
  return folded('fbc_fn_irr_ranges', 'EC and pH per crop', async box => {
    const draw = data => {
      const crops = data?.crops || [];
      box.replaceChildren(el('div', 'hint', 'The range in force for each crop of the plan and its stages. Starting values come from an extension guide '
        + '(Oklahoma State University Extension, HLA-6722, 2016) and are adjusted by the farm. The assistant keeps the recipes and programs it proposes inside them.'));
      if (!crops.length) { box.append(el('div', 'hint', 'No crop is planned on this FarmBox.')); return; }
      const t = el('table', 'table cr-table');
      const head = el('tr');
      ['Crop', 'Stage', 'EC mS/cm', 'pH', 'From', ''].forEach(h => head.append(el('th', null, h)));
      t.append(el('thead')); t.firstChild.append(head);
      const tb = el('tbody'); t.append(tb);
      crops.forEach(cr => (cr.stages || []).forEach((st, i) => {
        const r = st.range || {};
        const tr = el('tr');
        tr.append(el('td', null, i === 0 ? cr.crop : ''), el('td', null, st.name || STAGE[st.phase] || st.phase),
          el('td', null, span(r.ec)), el('td', null, span(r.ph)));
        const from = el('td', 'hint', [...new Set([r.ec?.from, r.ph?.from].filter(Boolean))].map(f => FROM[f] || f).join(' / ') || 'no range');
        from.title = [r.ec?.source, r.ph?.source].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k).join(' · ');
        tr.append(from);
        const act = el('td');
        if (data.may_edit) {
          const b = el('button', 'btn btn-sm btn-ghost', st.farm_row ? 'Change…' : 'Set…'); b.type = 'button';
          b.onclick = () => editRange(farm, cr, st, () => reload());
          act.append(b);
        }
        tr.append(act);
        tb.append(tr);
      }));
      const wrap = el('div', 'table-wrap'); wrap.append(t);
      box.append(wrap);
    };
    const reload = async () => { box.replaceChildren(loading('Reading…')); draw(await rpc('crop_ranges', { p_farm: farm.id }, { quiet: true })); };
    draw(await rpc('crop_ranges', { p_farm: farm.id }, { quiet: true }));
  });
}

function editRange(farm, cr, st, after) {
  const r = st.range || {}, own = st.farm_row || {};
  const d = drawer(`${cr.crop} · ${st.name || STAGE[st.phase] || st.phase}`, 'The farm\'s own EC and pH range. Empty both of a pair to leave it to the crop library or the starting value.');
  const n = (v, lo, hi) => { const i = el('input', 'input'); i.type = 'number'; i.step = '0.1'; i.min = String(lo); i.max = String(hi); i.value = v == null ? '' : String(v); return i; };
  const ecMin = n(own.ec_min, 0, 10), ecMax = n(own.ec_max, 0, 10), phMin = n(own.ph_min, 3, 9), phMax = n(own.ph_max, 3, 9);
  const note = el('input', 'input'); note.maxLength = 500; note.value = own.note || '';
  const pair = (a, b) => { const w = el('div', 'cr-pair'); w.append(a, el('span', null, '–'), b); return w; };
  d.body.append(
    field('EC (mS/cm), lowest – highest', pair(ecMin, ecMax), r.ec ? `In force now: ${span(r.ec)} (${FROM[r.ec.from] || r.ec.from})` : 'No EC range in force now.'),
    field('pH, lowest – highest', pair(phMin, phMax), r.ph ? `In force now: ${span(r.ph)} (${FROM[r.ph.from] || r.ph.from})` : 'No pH range in force now.'),
    field('Note', note, 'Why the farm uses this range (optional).'));
  const val = i => (i.value.trim() === '' ? null : Number(i.value));
  const send = async (button, all) => {
    const v = all ? [null, null, null, null] : [val(ecMin), val(ecMax), val(phMin), val(phMax)];
    if (!all) {
      if ((v[0] === null) !== (v[1] === null) || (v[2] === null) !== (v[3] === null)) { toast('A range has its lowest and its highest value', 'bad'); return; }
      if (v[0] !== null && !(v[0] >= 0 && v[1] <= 10 && v[0] < v[1])) { toast('EC: 0 to 10 mS/cm, the lowest below the highest', 'bad'); return; }
      if (v[2] !== null && !(v[2] >= 3 && v[3] <= 9 && v[2] < v[3])) { toast('pH: 3 to 9, the lowest below the highest', 'bad'); return; }
    }
    busy(button, true, 'Saving…');
    try {
      await rpc('save_crop_range', { p_farm: farm.id, p_crop: cr.crop_id, p_phase: st.phase, p_ec_min: v[0], p_ec_max: v[1], p_ph_min: v[2], p_ph_max: v[3],
        p_note: all ? null : note.value.trim() || null });
      toast(all ? 'Back to the library or the starting value' : 'Range saved', 'ok');
      d.close();
      after();
    } catch (e) { busy(button, false); toast(e?.message || String(e), 'bad'); }
  };
  const save = el('button', 'btn btn-primary', 'Save'); save.type = 'button'; save.onclick = () => send(save, false);
  const back = el('button', 'btn', 'Back to the starting value'); back.type = 'button'; back.onclick = () => send(back, true);
  back.disabled = !st.farm_row;
  d.footer.append(back, el('div', 'spacer'), save);
}
