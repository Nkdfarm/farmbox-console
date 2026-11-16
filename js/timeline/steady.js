// steady harvest over several zones: groups, banner, options window and preview
import { el, busy, toast, once, confirmDrawer, drawer, field, selectBox, systemLabel, loading,
         cropAvatar } from '../ui.js';
import { rpc } from '../api.js';
import { paint, reload, fits } from './index.js';
import { kgRow, plantsRow } from './weeks.js';
import { rowsText } from './succession.js';
import { dn, nice, S } from './state.js';

// ── a steady harvest over several zones (0.7.135, migration 0120) ─────────────
// Steady harvest… starts choosing: each zone header gets a tick box and a banner
// counts them; Optimise… opens the window (a crop and the positions for each zone,
// what "even" means, how far ahead) with a live preview; Plan it writes the
// proposals. The steady zones then stand first on the board, shaded, under the
// group's own lines (kg a week in all, and per crop). Changing a steady zone's
// positions plans the group again at once; Undo puts back the last change.
const OBJECTIVES = [['per_crop', 'Each crop even on its own'], ['total', 'All crops together (total kg)'],
                    ['harvests', 'The same number of harvests each week']];
const cropById = id => (S.data.crops || []).find(c => c.id === id);
const pct = cv => cv == null ? '—' : `±${Math.round(Number(cv) * 100)}%`;

// the FarmBox's steady groups, oldest first (an older database sends only one, as steady)
export const steadyGroups = () => S.data?.steady_groups || (S.data?.steady ? [S.data.steady] : []);
const groupById = id => steadyGroups().find(g => g.id === id) || null;
export const groupColour = g => `hsl(${g?.hue ?? 205} 60% 50%)`;
// a group is called what somebody named it, else after its crops
export function groupName(g) {
  if (!g) return 'New steady group';
  if (g.name) return g.name;
  const crops = [...new Set((S.data.systems || []).filter(s => s.steady_group_id === g.id).map(s => cropById(s.steady_crop_id)?.name).filter(Boolean))];
  return crops.length ? 'Steady · ' + crops.join(' + ') : 'Steady group';
}

export function startSteady(groupId) {
  S.steadyMode = true;
  S.steadyEdit = groupId || null;
  S.steadyPick = new Set(groupId ? (S.data.systems || []).filter(s => s.steady_group_id === groupId).map(s => s.id) : []);
  paint();
}
export function pickZone(id, on, zh) {
  on ? S.steadyPick.add(id) : S.steadyPick.delete(id);
  zh?.classList.toggle('picked', on);
  paintBanner();
}
export function steadyBar() {
  const g = groupById(S.steadyEdit);
  const bar = el('div', 'tl-steady-banner');
  if (g) bar.style.setProperty('--g', groupColour(g));
  const count = el('span', 'hint');
  const go = el('button', 'btn btn-sm btn-primary', 'Optimise…');
  go.onclick = () => openSteadyOptions([...S.steadyPick], S.steadyEdit);
  const no = el('button', 'btn btn-sm', 'Cancel');
  no.onclick = () => { S.steadyMode = false; S.steadyPick.clear(); S.steadyEdit = null; paint(); };
  const title = el('b');
  if (g) { const sw = el('i', 'tl-group-swatch'); sw.style.background = groupColour(g); title.append(sw, `Zones of ${groupName(g)}`); }
  else title.append('New steady group — pick its zones');
  bar.append(title, count, el('div', 'spacer'), go, no);
  S.steadyBanner = { count, go };
  paintBanner();
  return bar;
}
function paintBanner() {
  if (!S.steadyBanner) return;
  const n = S.steadyPick.size;
  const others = steadyGroups().filter(g => g.id !== S.steadyEdit).length;
  S.steadyBanner.count.textContent = (n ? ` · ${n} zone${n === 1 ? '' : 's'} ticked — different crops may be mixed`
                                      : ' · tick the zones on the board (the box beside each zone name)') +
    (others ? ` · zones of ${others === 1 ? 'the other group' : 'other groups'} cannot be ticked` : '');
  S.steadyBanner.go.disabled = !n;
}

// a group's head: its colour and name, how even it came out, its buttons; then its lines
export function steadyHead(g, zones, W, from, px) {
  const res = g.result || {};
  const head = el('div', 'tl-zone tl-group');
  head.style.setProperty('--g', groupColour(g));
  const lab = el('div', 'tl-label');
  const sw = el('i', 'tl-group-swatch'); sw.style.background = groupColour(g);
  lab.append(sw, el('b', 'tl-group-name', groupName(g)), el('span', 'hint', ` ${zones.length} zone${zones.length === 1 ? '' : 's'}`));
  lab.title = groupName(g);
  head.append(lab);
  const track = el('div', 'tl-zone-track');
  const obj = OBJECTIVES.find(o => o[0] === g.objective);
  const sum = (res.series || []).map(s => `${s.crop} every ${s.cycle_weeks} wk ${pct(s.cv)}`).join(' · ');
  track.append(el('span', 'tl-group-sum', (obj ? obj[1] : 'Each crop even') + (sum ? ' — ' + sum : '')));
  if (S.data.may_plan) {
    const ren = el('button', 'btn btn-sm btn-ghost', 'Rename…');
    ren.onclick = () => renameGroup(g);
    const edit = el('button', 'btn btn-sm btn-ghost', 'Change zones…');
    edit.onclick = () => startSteady(g.id);
    const again = el('button', 'btn btn-sm btn-ghost', 'Options…');
    again.title = 'The crops, positions and what "even" means for this group';
    again.onclick = () => openSteadyOptions(zones.map(z => z.id), g.id);
    track.append(ren, edit, again);
    if (g.undo) {
      const undo = el('button', 'btn btn-sm', '↶ Undo last change');
      undo.title = `Put back the positions and proposals of ${groupName(g)} as they were before its last plan`;
      undo.onclick = async () => {
        busy(undo, true, 'Undoing…');
        try { const r = await rpc('steady_undo', { p_group: g.id }); toast(`Put back as it was (${r.restored} proposals)`, 'ok'); await reload(); }
        catch (e) { busy(undo, false, '↶ Undo last change'); toast(e.message, 'bad'); }
      };
      track.append(undo);
    }
    const end = el('button', 'btn btn-sm btn-ghost tl-clear', 'End the group');
    end.onclick = () => once(end, async () => {
      if (!await confirmDrawer(`End ${groupName(g)}?`, 'Its zones go back to planning on their own. Every proposal stays where it is; the other steady groups are not touched.', 'End it')) return;
      try { await rpc('steady_dissolve', { p_group: g.id }); toast('Steady group ended — the proposals stay', 'ok'); await reload(); }
      catch (e) { toast(e.message, 'bad'); }
    });
    track.append(end);
  }
  head.append(track);
  const key = 'steady:' + g.id;
  const lines = [kgRow('Group · kg / week', W, key, from, px, false)];
  const crops = [...new Set(zones.map(z => z.steady_crop_id).filter(Boolean))];
  if (crops.length > 1) crops.forEach(id => lines.push(kgRow(`${cropById(id)?.name || 'Crop'} · kg`, W, key + ':' + id, from, px, false)));
  lines.push(plantsRow('Group · plants', W, key, from, px, false));
  lines.forEach(r => { r.classList.add('steady', 'group'); r.style.setProperty('--g', groupColour(g)); });
  return [head, ...lines];
}

function renameGroup(g) {
  const d = drawer('Name the steady group', 'Left empty, it is named after its crops');
  const name = el('input', 'input');
  name.type = 'text';
  name.value = g.name || '';
  name.placeholder = groupName({ ...g, name: null });
  name.maxLength = 60;
  d.body.append(field('Name', name));
  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Save');
  go.onclick = async () => {
    busy(go, true, 'Saving…');
    try { await rpc('steady_rename', { p_group: g.id, p_name: name.value }); d.close(); await reload(); }
    catch (e) { busy(go, false, 'Save'); toast(e.message, 'bad'); }
  };
  name.onkeydown = e => { if (e.key === 'Enter') go.click(); };
  d.footer.append(cancel, el('div', 'spacer'), go);
  setTimeout(() => name.focus(), 50);
}

// the chip on a steady zone: its group's colour and crop, and ✕ to take the zone out
export function steadyChip(sys, g) {
  const chip = el('span', 'tl-steady-chip');
  chip.style.setProperty('--g', groupColour(g));
  chip.title = groupName(g);
  chip.append(el('span', null, `Steady · ${cropById(sys.steady_crop_id)?.name || 'crop'}`));
  if (S.data.may_plan) {
    const x = el('button', 'tl-chip-x', '✕');
    x.title = `Take ${sys.name} out of ${groupName(g)}`;
    x.onclick = () => once(x, async () => {
      if (!await confirmDrawer(`Take ${sys.name} out?`, `Its proposals stay where they are; the other zones of ${groupName(g)} are planned again. Undo can put it back.`, 'Take it out')) return;
      try { await rpc('steady_leave', { p_system: sys.id }); toast(`${sys.name} left ${groupName(g)}`, 'ok'); await reload(); }
      catch (e) { toast(e.message, 'bad'); }
    });
    chip.append(x);
  }
  return chip;
}

// the crop a zone starts with in the window: its steady crop, else what it mostly holds, else the first that fits
function defaultCrop(sys) {
  const fitting = (S.data.crops || []).filter(c => fits(c, sys));
  if (sys.steady_crop_id && fitting.some(c => c.id === sys.steady_crop_id)) return sys.steady_crop_id;
  const ids = new Set((sys.positions || []).map(p => p.id)), count = new Map();
  (S.data.batches || []).filter(b => ids.has(b.position_id) && b.status !== 'harvested')
    .forEach(b => count.set(b.crop_id, (count.get(b.crop_id) || 0) + 1));
  const top = [...count.entries()].filter(([id]) => fitting.some(c => c.id === id)).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : fitting[0]?.id;
}

function openSteadyOptions(ids, groupId) {
  const g = groupById(groupId) || {};
  const zones = ids.map(id => (S.data.systems || []).find(s => s.id === id)).filter(Boolean);
  const d = drawer(groupId ? groupName(g) : 'New steady group',
    `${zones.length} zone${zones.length === 1 ? '' : 's'} planned together: every position replanted on a fixed weekly rhythm, for an even harvest`);
  const obj = selectBox(OBJECTIVES, g.objective || 'per_crop');
  const hz = selectBox([['91', '13 weeks'], ['182', '26 weeks'], ['364', '52 weeks']], String(g.horizon || 182));
  const top = el('div', 'grid2'); top.append(field('Keep even', obj), field('Plan ahead for', hz));
  d.body.append(top);

  const table = el('div', 'st-zones');
  const rows = zones.map(sys => {
    const fitting = (S.data.crops || []).filter(c => fits(c, sys));
    const crop = selectBox(fitting.map(c => [c.id, c.name]), defaultCrop(sys));
    const cur = (sys.positions || []).length;
    const opts = (sys.splits || []).map(o => [String(o.n), `${o.n} × ${Math.round(Number(o.places_each)).toLocaleString()} · ${rowsText(o.rows_each)}`]);
    if (!opts.some(o => Number(o[0]) === cur)) opts.push([String(cur), `${cur} (now)`]);
    const pos = selectBox(opts.sort((a, b) => Number(b[0]) - Number(a[0])), String(cur));
    pos.disabled = !!sys.locked;
    const r = el('div', 'st-zone');
    const name = el('div'); name.append(el('b', null, sys.name), el('div', 'hint', systemLabel(sys.type) + (sys.locked ? ' · positions fixed: batches validated or growing' : '')));
    r.append(name, crop, pos);
    table.append(r);
    return { sys, crop, pos };
  });
  const head = el('div', 'st-zone st-zone-head'); head.append(el('span', 'hint', 'Zone'), el('span', 'hint', 'Crop'), el('span', 'hint', 'Positions'));
  table.prepend(head);
  const sug = el('button', 'btn btn-sm', 'Suggest positions');
  sug.title = 'Try every split each zone allows and keep the most even — fewer positions when the difference is small';
  const tools = el('div', 'row'); tools.append(sug, el('span', 'hint', 'or choose the positions yourself; the preview follows'));
  d.body.append(el('div', 'sec-title', 'Zones'), table, tools);

  const prev = el('div', 'st-preview');
  d.body.append(el('div', 'sec-title', 'Preview'), prev);
  const args = () => ({ p_farm: S.farm.id, p_group: groupId || null, p_objective: obj.value, p_horizon: Number(hz.value),
                        p_zones: rows.map(r => ({ system_id: r.sys.id, crop_id: r.crop.value, n: Number(r.pos.value) })) });
  let seq = 0, timer = null;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq;
      prev.replaceChildren(loading('Working out the rhythm…'));
      try { const r = await rpc('steady_preview', args(), { quiet: true }); if (my === seq) drawSteadyPreview(prev, r); }
      catch (e) { if (my === seq) prev.replaceChildren(el('div', 'note bad', e.message)); }
    }, 300);
  };
  [obj, hz, ...rows.flatMap(r => [r.crop, r.pos])].forEach(x => x.onchange = preview);
  sug.onclick = async () => {
    busy(sug, true, 'Trying the splits…');
    const my = ++seq;
    try {
      const r = await rpc('steady_suggest', args(), { quiet: true });
      (r.suggested || []).forEach(s => { const row = rows.find(x => x.sys.id === s.system_id); if (row) row.pos.value = String(s.n); });
      if (my === seq) drawSteadyPreview(prev, r);
      busy(sug, false, 'Suggest positions');
    } catch (e) { busy(sug, false, 'Suggest positions'); toast(e.message, 'bad'); }
  };
  preview();

  const cancel = el('button', 'btn', 'Cancel'); cancel.onclick = d.close;
  const go = el('button', 'btn btn-primary', 'Plan it');
  go.onclick = async () => {
    busy(go, true, 'Planning…');
    try {
      const r = await rpc('steady_apply', args());
      d.close();
      S.steadyMode = false; S.steadyPick.clear(); S.steadyEdit = null;
      toast(`Steady harvest: ${r.batches} batches proposed over ${zones.length} zone${zones.length === 1 ? '' : 's'} · ≈ ${Math.round(r.expected_kg || 0).toLocaleString()} kg` +
            " · Undo is in the group's bar", 'ok');
      await reload();
    } catch (e) { busy(go, false, 'Plan it'); toast(e.message, 'bad'); }
  };
  d.footer.append(cancel, el('div', 'spacer'), go);
}

// the preview: each crop's rhythm and evenness, then the weeks, stacked by crop
// one colour per crop of the preview (the category hue would give two lettuces the same green)
const ST_HUES = [145, 28, 205, 285, 350, 55, 180, 320];
function drawSteadyPreview(box, r) {
  box.textContent = '';
  (r.notes || []).forEach(n => box.append(el('div', 'note warn', n)));
  const ids = [...new Set((r.zones || []).map(z => z.crop_id))];
  const colourOf = id => `hsl(${ST_HUES[Math.max(ids.indexOf(id), 0) % ST_HUES.length]} 55% 50%)`;
  const list = el('div', 'st-series');
  (r.series || []).forEach(s => {
    const c = s.crop_id ? cropById(s.crop_id) : null;
    const line = el('div', 'st-line');
    const name = el('div', 'st-name');
    if (s.crop_id) { const sw = el('i', 'st-swatch'); sw.style.background = colourOf(s.crop_id); name.append(sw); }
    if (c) name.append(cropAvatar(c, 'xs'));
    name.append(el('b', null, s.crop));
    const cv = s.cv == null ? null : Number(s.cv);
    const meter = el('div', 'tl-steady-meter'); const f = el('i'); f.style.width = Math.max(4, 100 - Math.min(100, (cv ?? 1) * 100)) + '%'; meter.append(f);
    const facts = el('div', 'st-facts');
    facts.append(el('span', null, `${s.positions} position${s.positions === 1 ? '' : 's'}, each replanted every ${s.cycle_weeks} week${s.cycle_weeks === 1 ? '' : 's'}`),
                 el('span', 'hint', r.objective === 'harvests' ? `${Number(s.mean || 0).toFixed(1)} harvests a week, ${pct(cv)}`
                                    : `≈ ${Math.round(s.mean || 0).toLocaleString()} kg a week (${Math.round(s.min || 0)}–${Math.round(s.max || 0)}), ${pct(cv)}`),
                 el('span', 'hint', s.from ? `even from ${nice(s.from)}` : ''));
    if (Number(s.skipped)) facts.append(el('span', 'hint', `${s.skipped} planting${s.skipped == 1 ? '' : 's'} skipped: a batch already stands there`));
    line.append(name, facts, meter);
    list.append(line);
  });
  box.append(list);
  if (r.total && r.total.cv != null && (r.series || []).length > 1)
    box.append(el('div', 'hint', `All these zones together: ≈ ${Math.round(r.total.mean || 0).toLocaleString()} ${r.objective === 'harvests' ? 'harvests' : 'kg'} a week, ${pct(r.total.cv)}`));
  const weeks = r.weeks || [];
  if (!weeks.length) { box.append(el('div', 'hint', 'Nothing would be harvested inside the window.')); return; }
  const max = Math.max(1, ...weeks.map(w => Number(r.objective === 'harvests' ? w.cuts : w.kg)));
  const from = r.total?.from ? dn(r.total.from) : null, to = r.total?.to ? dn(r.total.to) : null;
  const chart = el('div', 'st-chart');
  weeks.forEach(w => {
    const col = el('div', 'st-col' + (from != null && (dn(w.w) < from || dn(w.w) > to) ? ' ramp' : ''));
    if (r.objective === 'harvests') {
      const seg = el('span'); seg.style.height = (100 * Number(w.cuts) / max) + '%'; seg.style.background = 'var(--accent)'; col.append(seg);
    } else {
      Object.entries(w.c || {}).forEach(([id, kg]) => {
        const seg = el('span'); seg.style.height = (100 * Number(kg) / max) + '%';
        seg.style.background = colourOf(id);
        col.append(seg);
      });
    }
    col.title = `Week of ${nice(w.w)}: ${Math.round(w.kg).toLocaleString()} kg · ${w.cuts} harvest${w.cuts === 1 ? '' : 's'} starting` +
      Object.entries(w.c || {}).map(([id, kg]) => `\n  ${cropById(id)?.name || 'crop'}: ${Math.round(kg)} kg`).join('');
    chart.append(col);
  });
  const axis = el('div', 'st-axis'); axis.append(el('span', null, nice(weeks[0].w)), el('span', null, nice(weeks[weeks.length - 1].w)));
  box.append(chart, axis, el('div', 'hint', 'Dimmed weeks: the first plantings coming in (or the last going out), before every position is harvesting. Hover a week for its crops.'));
}
